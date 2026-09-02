-- Admin-notification-on-customer-response feature: the customer-facing
-- confirm page's respond action (respond_to_dispatch_confirmation) used
-- to return only (ok, status) -- enough for the page itself to show the
-- right screen, but nothing the new /api/dispatch/respond route can use
-- to build an admin email (which module, whose record, what to link to).
-- Extended to also return entity_type/entity_id/label, captured straight
-- off each table's own UPDATE ... RETURNING (same row already being
-- updated, no extra query needed).
--
-- Return type is changing (new output columns), which `create or replace
-- function` can't do for the same argument list -- has to be dropped and
-- recreated, same as approve_dispatch_item's own signature change
-- earlier (dispatch_dual_channel_notifications migration).
drop function if exists public.respond_to_dispatch_confirmation(uuid, text);

create or replace function public.respond_to_dispatch_confirmation(p_token uuid, p_action text)
returns table (
  out_ok boolean,
  out_status text,
  out_entity_type text,
  out_entity_id uuid,
  out_label text,
  out_scheduled_date text
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_new_status text;
  v_updated integer := 0;
  v_entity_type text;
  v_entity_id uuid;
  v_label text;
  v_scheduled_date text;
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
      and confirmation_token_expires_at > now()
    returning id, coalesce(member_account, order_number), coalesce(pre_d, plan_date)::text
    into v_entity_id, v_label, v_scheduled_date;
  get diagnostics v_updated = row_count;
  if v_updated > 0 then
    v_entity_type := 'filter_change_plans';
  end if;

  if v_updated = 0 then
    update public.install_plans
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now()
      returning id, coalesce(name, order_no), coalesce(pre_installed_date, input_date)::text
      into v_entity_id, v_label, v_scheduled_date;
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      v_entity_type := 'install_plans';
    end if;
  end if;

  if v_updated = 0 then
    update public.collections
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now()
      returning id, coalesce(account_name, order_no), coalesce(pre_d, collection_date)::text
      into v_entity_id, v_label, v_scheduled_date;
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      v_entity_type := 'collections';
    end if;
  end if;

  if v_updated = 0 then
    update public.repair_plans
      set dispatch_status = v_new_status, customer_responded_at = now()
      where confirmation_token = p_token and dispatch_status = 'Pending Customer Confirmation'
        and confirmation_token_expires_at > now()
      returning id, coalesce(account_name, order_no), coalesce(pre_d, issued_date)::text
      into v_entity_id, v_label, v_scheduled_date;
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      v_entity_type := 'repair_plans';
    end if;
  end if;

  out_ok := v_updated > 0;
  out_status := v_new_status;
  out_entity_type := v_entity_type;
  out_entity_id := v_entity_id;
  out_label := v_label;
  out_scheduled_date := v_scheduled_date;
  return next;
end;
$$;

grant execute on function public.respond_to_dispatch_confirmation(uuid, text) to anon, authenticated;
