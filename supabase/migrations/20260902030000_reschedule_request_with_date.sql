-- Closes the loop on "Reschedule Requested": clicking "Request a
-- different date" on the confirm page used to be a pure decline signal
-- with no admin review surface at all (the Pending Dispatch Approval
-- queue only ever showed Draft; the Daily Report deliberately excludes
-- Reschedule Requested too) -- the record just went quiet. Now the
-- customer can attach the date/time they'd actually prefer, an admin
-- reviews and accepts it from the same approval queue, and only then
-- does the real schedule field (pre_d / pre_installed_date) update and a
-- "you're confirmed" notification go out. Time-of-day is a courtesy
-- display detail only, confirmed with the user rather than assumed --
-- it's never written to pre_d or any other real schedule field anywhere,
-- stored as plain text (requested_time) rather than a time type, since
-- nothing else in this schema has a time-of-day concept to be consistent
-- with.
do $$
declare
  t text;
begin
  foreach t in array array['filter_change_plans', 'install_plans', 'collections', 'repair_plans']
  loop
    execute format($f$
      alter table public.%I
        add column if not exists requested_date date,
        add column if not exists requested_time text;
    $f$, t);
  end loop;
end $$;

-- respond_to_dispatch_confirmation() gains two new optional params,
-- stored only when the action is 'reschedule' -- a 'confirm' leaves them
-- untouched (they'd already be null on a first-time response anyway).
-- Return shape is unchanged from the respond_returns_entity_details
-- migration: the route already has requestedDate/requestedTime from its
-- own request body, so there's nothing new to echo back.
drop function if exists public.respond_to_dispatch_confirmation(uuid, text);

create or replace function public.respond_to_dispatch_confirmation(
  p_token uuid,
  p_action text,
  p_requested_date date default null,
  p_requested_time text default null
)
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
    set dispatch_status = v_new_status, customer_responded_at = now(),
      requested_date = case when p_action = 'reschedule' then p_requested_date else requested_date end,
      requested_time = case when p_action = 'reschedule' then p_requested_time else requested_time end
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
      set dispatch_status = v_new_status, customer_responded_at = now(),
        requested_date = case when p_action = 'reschedule' then p_requested_date else requested_date end,
        requested_time = case when p_action = 'reschedule' then p_requested_time else requested_time end
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
      set dispatch_status = v_new_status, customer_responded_at = now(),
        requested_date = case when p_action = 'reschedule' then p_requested_date else requested_date end,
        requested_time = case when p_action = 'reschedule' then p_requested_time else requested_time end
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
      set dispatch_status = v_new_status, customer_responded_at = now(),
        requested_date = case when p_action = 'reschedule' then p_requested_date else requested_date end,
        requested_time = case when p_action = 'reschedule' then p_requested_time else requested_time end
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

grant execute on function public.respond_to_dispatch_confirmation(uuid, text, date, text) to anon, authenticated;

-- accept_requested_reschedule(): the admin's "yes, that date works" action
-- from the Pending Dispatch Approval queue's new Reschedule Requests
-- section. Only ever succeeds against a row that's actually
-- 'Reschedule Requested' with a requested_date on file (a decline with no
-- alternate date has nothing to accept -- the admin's only path there is
-- editing Pre D directly, same as any other admin-chooses-the-date case).
-- Applies requested_date straight to the real schedule field and jumps
-- directly to 'Confirmed' -- no new token, no second customer click,
-- since the customer already told us this exact date works. requested_
-- date/requested_time are deliberately left in place afterward (not
-- cleared) as a plain historical record of what was asked for, same as
-- customer_responded_at is never cleared either. confirmation_token is
-- returned (not regenerated) so the route can build a link back to the
-- customer's existing /confirm/[token] page, which will now correctly
-- show the "you're confirmed" screen for the new date.
create or replace function public.accept_requested_reschedule(
  p_entity_type text,
  p_entity_id uuid
)
returns table (
  out_ok boolean,
  out_label text,
  out_scheduled_date text,
  out_requested_time text,
  out_notify_phone text,
  out_notify_email text,
  out_confirmation_token uuid
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_label text;
  v_scheduled_date text;
  v_requested_time text;
  v_notify_phone text;
  v_notify_email text;
  v_confirmation_token uuid;
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept a requested reschedule';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;

  if p_entity_type = 'filter_change_plans' then
    update public.filter_change_plans
      set pre_d = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(member_account, order_number), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token;
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set pre_installed_date = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(name, order_no), pre_installed_date::text, requested_time, notify_phone, notify_email, confirmation_token
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token;
  elsif p_entity_type = 'collections' then
    update public.collections
      set pre_d = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token;
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set pre_d = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token;
  end if;
  get diagnostics v_updated = row_count;

  out_ok := v_updated > 0;
  out_label := v_label;
  out_scheduled_date := v_scheduled_date;
  out_requested_time := v_requested_time;
  out_notify_phone := v_notify_phone;
  out_notify_email := v_notify_email;
  out_confirmation_token := v_confirmation_token;
  return next;
end;
$$;

grant execute on function public.accept_requested_reschedule(text, uuid) to authenticated;

-- The Pre-D-reset trigger (reset_dispatch_on_pre_d_edit migration)
-- previously only watched 'Pending Customer Confirmation' -- extended to
-- also cover 'Reschedule Requested', which is the admin's actual "I
-- disagree with what the customer asked for" path: editing Pre D
-- directly resets the row to Draft (re-entering the normal approval
-- queue with the admin's own chosen date) exactly like it already does
-- for a mid-flight Pending Customer Confirmation row -- no separate
-- reject/counter-propose UI needed. The now-stale requested_date/
-- requested_time are cleared in this case specifically (unlike
-- accept_requested_reschedule, which keeps them as history) since the
-- admin has just overridden them with a different date of their own.
create or replace function public.reset_dispatch_status_on_pre_d_change()
returns trigger
language plpgsql
as $$
begin
  if new.pre_d is distinct from old.pre_d and old.dispatch_status in ('Pending Customer Confirmation', 'Reschedule Requested') then
    new.dispatch_status := 'Draft';
    new.confirmation_token := null;
    new.confirmation_token_expires_at := null;
    new.requested_date := null;
    new.requested_time := null;
  end if;
  return new;
end;
$$;
