-- Contact-based counterpart to respond_to_dispatch_confirmation(), added
-- for the SMS-reply webhook (src/app/api/webhooks/sms-reply/route.ts).
--
-- An inbound SMS reply ("YES"/"RESCHEDULE") has no confirmation_token in
-- it — only the sender's phone number and their message text — so the
-- token-keyed RPC from the dispatch_confirmation_workflow migration can't
-- resolve it. This instead looks up the single most-recently-notified row
-- across all four dispatch tables whose notify_contact matches the sender
-- and whose dispatch_status is still 'Pending Customer Confirmation'
-- (ties broken by customer_notified_at, newest first) — same one-of-four-
-- tables-via-UNION-ALL shape as get_dispatch_confirmation_details(), just
-- keyed differently. Only ever called server-side by the webhook route
-- using the service-role client (never exposed to anon/authenticated —
-- there's no token here to scope it to a single record, so it must stay
-- off the public surface), same restriction as the cron-only schedule-
-- extension RPCs.
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
      where notify_contact = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'install_plans', id, coalesce(name, order_no), customer_notified_at
      from public.install_plans
      where notify_contact = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'collections', id, coalesce(account_name, order_no), customer_notified_at
      from public.collections
      where notify_contact = p_contact and dispatch_status = 'Pending Customer Confirmation'
    union all
    select 'repair_plans', id, coalesce(account_name, order_no), customer_notified_at
      from public.repair_plans
      where notify_contact = p_contact and dispatch_status = 'Pending Customer Confirmation'
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

-- Service-role only — see the comment above for why this can't be granted
-- to anon/authenticated the way the token-keyed RPCs are.
grant execute on function public.respond_to_dispatch_confirmation_by_contact(text, text) to service_role;
