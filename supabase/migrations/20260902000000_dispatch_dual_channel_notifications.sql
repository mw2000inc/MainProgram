-- Real SMS (Semaphore) + Email (Resend) delivery for dispatch approval,
-- replacing the notification stub from dispatch_confirmation_workflow now
-- that both providers have been chosen (see that migration's own top
-- comment for the original "no provider exists yet" context).
--
-- Approving now always attempts BOTH channels, one per contact the admin
-- has on file, rather than the admin picking a single channel — so the
-- old single free-text notify_contact + channel pair is replaced with two
-- separate columns, one per channel. notify_contact itself is left in
-- place (unused going forward) rather than dropped, since it's harmless
-- and a destructive column drop buys nothing here.
--
-- The actual outbound HTTP calls to Semaphore/Resend can only happen from
-- server-side TypeScript (Postgres has no built-in way to make them
-- without the pg_net extension, which this project doesn't use anywhere
-- else) — so approve_dispatch_item() now only does the DB-side
-- transition (validate + generate token + move to 'Pending Customer
-- Confirmation') and returns what the caller needs to actually build and
-- send the messages. The real send + the dispatch_notifications log entry
-- (one row per channel actually attempted, status genuinely 'sent' or
-- 'failed' based on the provider's own response — never 'stub_logged'
-- again) both now live in src/app/api/dispatch/approve/route.ts, using
-- the service-role client for the log insert exactly like every other
-- write nothing-but-a-privileged-server-route is trusted to make (see
-- src/app/api/admin/users/route.ts for the same admin-recheck-then-
-- service-role-client pattern).
do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'install_plans', 'collections', 'repair_plans']
  loop
    execute format($f$
      alter table public.%I
        add column if not exists notify_phone text,
        add column if not exists notify_email text;
    $f$, t);
  end loop;
end $$;

-- Old 5-arg signature (single contact + channel + base url) is being
-- replaced by a 4-arg one (separate phone/email, no base url — the route
-- builds the confirm link itself since it also builds the rest of each
-- channel's message). Different arg count means `create or replace` would
-- just add a second overload rather than replacing it, so the old one is
-- dropped explicitly first.
drop function if exists public.approve_dispatch_item(text, uuid, text, text, text);

create or replace function public.approve_dispatch_item(
  p_entity_type text,
  p_entity_id uuid,
  p_notify_phone text,
  p_notify_email text
)
returns table (out_token uuid, out_label text, out_scheduled_date text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_label text;
  v_date text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve a dispatch item';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;
  if coalesce(nullif(p_notify_phone, ''), nullif(p_notify_email, '')) is null then
    raise exception 'At least one of phone or email is required';
  end if;

  if p_entity_type = 'filter_change_plans' then
    select coalesce(member_account, order_number), coalesce(pre_d, plan_date)::text into v_label, v_date
      from public.filter_change_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.filter_change_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_phone = nullif(p_notify_phone, ''),
        notify_email = nullif(p_notify_email, ''),
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'install_plans' then
    select coalesce(name, order_no), coalesce(pre_installed_date, input_date)::text into v_label, v_date
      from public.install_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.install_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_phone = nullif(p_notify_phone, ''),
        notify_email = nullif(p_notify_email, ''),
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'collections' then
    select coalesce(account_name, order_no), coalesce(pre_d, collection_date)::text into v_label, v_date
      from public.collections where id = p_entity_id and dispatch_status = 'Draft';
    update public.collections
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_phone = nullif(p_notify_phone, ''),
        notify_email = nullif(p_notify_email, ''),
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'repair_plans' then
    select coalesce(account_name, order_no), coalesce(pre_d, issued_date)::text into v_label, v_date
      from public.repair_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.repair_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_phone = nullif(p_notify_phone, ''),
        notify_email = nullif(p_notify_email, ''),
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  end if;

  if v_label is null then
    -- Nothing matched a Draft row with this id/type — no-op, no token.
    return;
  end if;

  out_token := v_token;
  out_label := v_label;
  out_scheduled_date := v_date;
  return next;
end;
$$;

grant execute on function public.approve_dispatch_item(text, uuid, text, text) to authenticated;

-- The SMS-reply webhook (src/app/api/webhooks/sms-reply/route.ts) matches
-- an inbound reply by the sender's phone number — updated to match
-- notify_phone specifically now that phone/email are separate columns,
-- rather than the old generic notify_contact (which could have held
-- either). Same signature as before, so this replaces in place.
create or replace function public.respond_to_dispatch_confirmation_by_contact(p_contact text, p_action text)
returns table (out_ok boolean, out_status text, out_entity_type text, out_label text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_new_status text;
  v_entity_type text;
  v_entity_id uuid;
  v_label text;
begin
  if p_action = 'confirm' then
    v_new_status := 'Confirmed';
  elsif p_action = 'reschedule' then
    v_new_status := 'Reschedule Requested';
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  select et, id, label into v_entity_type, v_entity_id, v_label
  from (
    select 'filter_change_plans' as et, id, coalesce(member_account, order_number) as label, customer_notified_at as notified
      from public.filter_change_plans
      where notify_phone = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'install_plans', id, coalesce(name, order_no), customer_notified_at
      from public.install_plans
      where notify_phone = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'collections', id, coalesce(account_name, order_no), customer_notified_at
      from public.collections
      where notify_phone = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'repair_plans', id, coalesce(account_name, order_no), customer_notified_at
      from public.repair_plans
      where notify_phone = p_contact and dispatch_status = 'Pending Customer Confirmation'
  ) candidates
  order by notified desc nulls last
  limit 1;

  if v_entity_type is null then
    out_ok := false;
    return next;
    return;
  end if;

  if v_entity_type = 'filter_change_plans' then
    update public.filter_change_plans set dispatch_status = v_new_status, customer_responded_at = now() where id = v_entity_id;
  elsif v_entity_type = 'install_plans' then
    update public.install_plans set dispatch_status = v_new_status, customer_responded_at = now() where id = v_entity_id;
  elsif v_entity_type = 'collections' then
    update public.collections set dispatch_status = v_new_status, customer_responded_at = now() where id = v_entity_id;
  elsif v_entity_type = 'repair_plans' then
    update public.repair_plans set dispatch_status = v_new_status, customer_responded_at = now() where id = v_entity_id;
  end if;

  out_ok := true;
  out_status := v_new_status;
  out_entity_type := v_entity_type;
  out_label := v_label;
  return next;
end;
$$;

grant execute on function public.respond_to_dispatch_confirmation_by_contact(text, text) to service_role;
