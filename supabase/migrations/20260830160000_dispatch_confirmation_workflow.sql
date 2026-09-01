-- Admin-gated customer dispatch confirmation workflow.
--
-- Confirmed with the admin before implementing:
--   * No SMS/Email provider exists anywhere in this project today (checked
--     the whole codebase, not guessed) — actual delivery is a deliberate
--     stub here (logged to a real table, never claimed as "sent"). Wiring a
--     real provider in is a separate follow-up once one is chosen.
--   * Every EXISTING row across all four tables is grandfathered straight
--     to 'Confirmed' (the new column's own default), so nothing already
--     visible on the Daily Report disappears. Only a NEW record created
--     through each module's own "Add" form from now on starts at 'Draft'
--     and enters the approval queue — bulk system-generated occurrences
--     (the recurring-schedule generators, the C/T-completion cascade) are
--     NOT touched by this migration and keep inserting at the same default
--     ('Confirmed'), since requiring a fresh customer confirmation for
--     every one of a customer's already-agreed quarterly/yearly occurrences
--     would be an unreasonable admin burden — only a genuinely new,
--     one-off dispatch an admin is actively scheduling goes through this.
--
-- Flow: Draft (new manual record, not yet reviewed) --admin approves-->
-- Pending Customer Confirmation (stub notification "sent", token issued)
-- --customer visits /confirm/[token]--> Confirmed or Reschedule Requested.
-- Only 'Confirmed' rows are eligible for the Daily Report (see the
-- frontend change in daily-report-section.tsx) — matches "Admin-Approved
-- AND Customer-Confirmed" from the request exactly, since reaching
-- 'Confirmed' can only happen after the admin's own approval step already
-- moved the row to 'Pending Customer Confirmation' first.

-- =========================================================================
-- 1. Schema — the same five columns on all four dispatch tables.
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'install_plans', 'collections', 'repair_plans']
  loop
    execute format($f$
      alter table public.%I
        add column if not exists dispatch_status text not null default 'Confirmed',
        add column if not exists confirmation_token uuid,
        add column if not exists confirmation_token_expires_at timestamptz,
        add column if not exists notify_contact text,
        add column if not exists customer_notified_at timestamptz,
        add column if not exists customer_responded_at timestamptz;
    $f$, t);

    execute format('alter table public.%I drop constraint if exists %I;', t, t || '_dispatch_status_check');
    execute format($f$
      alter table public.%I add constraint %I
        check (dispatch_status in ('Draft', 'Pending Customer Confirmation', 'Confirmed', 'Reschedule Requested'));
    $f$, t, t || '_dispatch_status_check');

    execute format(
      'create unique index if not exists %I on public.%I (confirmation_token) where confirmation_token is not null;',
      t || '_confirmation_token_key', t
    );
  end loop;
end $$;

-- =========================================================================
-- 2. Notification log — records exactly what a real provider integration
--    would be asked to send, without actually sending anything. Lets
--    admins see/audit what "would have gone out" and gives the follow-up
--    provider wiring a single, already-correct call site to replace.
-- =========================================================================
create table if not exists public.dispatch_notifications (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans')),
  entity_id uuid not null,
  channel text not null check (channel in ('sms', 'email')),
  recipient text not null,
  message text not null,
  -- Always 'stub_logged' until a real provider is wired in — never a value
  -- implying an actual send succeeded.
  status text not null default 'stub_logged',
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.dispatch_notifications enable row level security;
drop policy if exists "dispatch_notifications_select_admin" on public.dispatch_notifications;
create policy "dispatch_notifications_select_admin" on public.dispatch_notifications
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policy for any authenticated role — the only way
-- a row is ever written is through approve_dispatch_item() below, a
-- SECURITY DEFINER function, same "nobody can insert a fabricated entry
-- directly" pattern as activity_logs.

-- =========================================================================
-- 3. approve_dispatch_item() — the Admin Approval step. Admin-only
--    (re-checked here, not just at the UI layer — RLS-equivalent
--    enforcement for an RPC). Generates the confirmation token, moves the
--    row to 'Pending Customer Confirmation', and logs the stub
--    notification. p_notify_contact is admin-supplied at approval time
--    (rather than assumed from the row) since two of the four tables
--    (collections, repair_plans) have no phone/email column of their own
--    to fall back on.
-- =========================================================================
create or replace function public.approve_dispatch_item(
  p_entity_type text,
  p_entity_id uuid,
  p_notify_contact text,
  p_channel text,
  p_confirm_base_url text
)
returns table (out_token uuid, out_message text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_message text;
  v_label text;
  v_date text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve a dispatch item';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;
  if p_channel not in ('sms', 'email') then
    raise exception 'Unknown channel: %', p_channel;
  end if;

  if p_entity_type = 'filter_change_plans' then
    select coalesce(member_account, order_number), coalesce(pre_d, plan_date)::text into v_label, v_date
      from public.filter_change_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.filter_change_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_contact = p_notify_contact,
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'install_plans' then
    select coalesce(name, order_no), coalesce(pre_installed_date, input_date)::text into v_label, v_date
      from public.install_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.install_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_contact = p_notify_contact,
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'collections' then
    select coalesce(account_name, order_no), coalesce(pre_d, collection_date)::text into v_label, v_date
      from public.collections where id = p_entity_id and dispatch_status = 'Draft';
    update public.collections
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_contact = p_notify_contact,
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  elsif p_entity_type = 'repair_plans' then
    select coalesce(account_name, order_no), coalesce(pre_d, issued_date)::text into v_label, v_date
      from public.repair_plans where id = p_entity_id and dispatch_status = 'Draft';
    update public.repair_plans
      set dispatch_status = 'Pending Customer Confirmation',
        confirmation_token = v_token,
        confirmation_token_expires_at = now() + interval '7 days',
        notify_contact = p_notify_contact,
        customer_notified_at = now()
      where id = p_entity_id and dispatch_status = 'Draft';
  end if;

  if v_label is null then
    -- Nothing matched a Draft row with this id/type — no-op, no token.
    return;
  end if;

  v_message := format(
    'Hi %s, please confirm your scheduled visit on %s: %s/confirm/%s',
    v_label, v_date, rtrim(p_confirm_base_url, '/'), v_token
  );

  insert into public.dispatch_notifications (entity_type, entity_id, channel, recipient, message, created_by)
  values (p_entity_type, p_entity_id, p_channel, p_notify_contact, v_message, auth.uid());

  out_token := v_token;
  out_message := v_message;
  return next;
end;
$$;

grant execute on function public.approve_dispatch_item(text, uuid, text, text, text) to authenticated;

-- =========================================================================
-- 4. Customer-facing lookups/actions, reachable anonymously (the customer
--    is never logged in) via a confirmation token alone — same
--    "SECURITY DEFINER RPC instead of loosening RLS to anon" pattern
--    already used for the customer portal's get_portal_profile().
-- =========================================================================
create or replace function public.get_dispatch_confirmation_details(p_token uuid)
returns table (
  out_entity_type text,
  out_label text,
  out_scheduled_date date,
  out_status text,
  out_valid boolean
)
language plpgsql
security definer set search_path = public
stable
as $$
declare
  r record;
begin
  for r in
    select 'filter_change_plans' as et, coalesce(member_account, order_number) as label,
      coalesce(pre_d, plan_date) as sched, dispatch_status as st, confirmation_token_expires_at as exp
      from public.filter_change_plans where confirmation_token = p_token
    union all
    select 'install_plans', coalesce(name, order_no), coalesce(pre_installed_date, input_date), dispatch_status, confirmation_token_expires_at
      from public.install_plans where confirmation_token = p_token
    union all
    select 'collections', coalesce(account_name, order_no), coalesce(pre_d, collection_date), dispatch_status, confirmation_token_expires_at
      from public.collections where confirmation_token = p_token
    union all
    select 'repair_plans', coalesce(account_name, order_no), coalesce(pre_d, issued_date), dispatch_status, confirmation_token_expires_at
      from public.repair_plans where confirmation_token = p_token
  loop
    out_entity_type := r.et;
    out_label := r.label;
    out_scheduled_date := r.sched;
    out_status := r.st;
    out_valid := r.exp is not null and r.exp > now();
    return next;
    return;
  end loop;
end;
$$;

grant execute on function public.get_dispatch_confirmation_details(uuid) to anon, authenticated;

create or replace function public.respond_to_dispatch_confirmation(p_token uuid, p_action text)
returns table (out_ok boolean, out_status text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_new_status text;
  v_updated integer := 0;
begin
  if p_action = 'confirm' then
    v_new_status := 'Confirmed';
  elsif p_action = 'reschedule' then
    v_new_status := 'Reschedule Requested';
  else
    raise exception 'Unknown action: %', p_action;
  end if;

  update public.filter_change_plans
    set dispatch_status = v_new_status, customer_responded_at = now()
    where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
      and confirmation_token_expires_at > now();
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    update public.install_plans
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now();
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 then
    update public.collections
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now();
    get diagnostics v_updated = row_count;
  end if;

  if v_updated = 0 then
    update public.repair_plans
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now();
    get diagnostics v_updated = row_count;
  end if;

  out_ok := v_updated > 0;
  out_status := v_new_status;
  return next;
end;
$$;

grant execute on function public.respond_to_dispatch_confirmation(uuid, text) to anon, authenticated;
