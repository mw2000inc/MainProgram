-- Closes the gap between the dispatch-confirmation workflow and the
-- Schedule panel: a customer confirming (or an admin accepting their
-- requested reschedule) used to require a separate, fully manual
-- "Schedule a Job" step before the technician's Schedule panel
-- (schedule_jobs, read by ScheduleAgenda) showed anything at all. Nothing
-- was actually missing to automate this -- schedule_jobs.technician
-- already defaults to '' and technician_user_id is already nullable
-- (an unassigned job is already a normal, expected state elsewhere in
-- this app -- see the technician_role migration's own comment on that);
-- this was simply never wired up, since the dispatch-confirmation
-- workflow was built independently of schedule_jobs.
--
-- Only fires on an actual customer-driven confirm (respond_to_dispatch_
-- confirmation, action='confirm') or an admin's accept of a customer's
-- requested reschedule (accept_requested_reschedule) -- never on the
-- initial admin approval (Draft -> Pending Customer Confirmation), since
-- nothing is real yet at that point, consistent with Pre D itself not
-- moving until confirmation either.
--
-- Known limitation, confirmed out of scope for now: if an admin edits
-- Pre D again *after* a record is already Confirmed, nothing currently
-- pushes that change into the linked schedule_jobs.scheduled_date -- the
-- two can drift apart. Editing Pre D post-confirmation is expected to be
-- rare; revisit with a sync trigger if that turns out not to hold.

-- =========================================================================
-- 1. install_plans/repair_plans get a schedule_job_id back-link, matching
--    the one filter_change_plans/collections already got from the
--    ct_filter_change_collection_inventory_link migration. Neither table
--    has a customer_id column (a pre-existing gap, not something this
--    migration adds) -- find_or_create_schedule_job below just receives
--    null for customer_id on these two.
-- =========================================================================
alter table public.install_plans
  add column if not exists schedule_job_id uuid references public.schedule_jobs(id) on delete set null;
create unique index if not exists install_plans_schedule_job_id_key
  on public.install_plans (schedule_job_id) where schedule_job_id is not null;

alter table public.repair_plans
  add column if not exists schedule_job_id uuid references public.schedule_jobs(id) on delete set null;
create unique index if not exists repair_plans_schedule_job_id_key
  on public.repair_plans (schedule_job_id) where schedule_job_id is not null;

-- =========================================================================
-- 2. find_or_create_schedule_job() -- the shared "reuse or insert" helper
--    both RPCs below call. Reuses an existing *pending* job matching the
--    same job_type + order_no + date rather than blind-inserting, since
--    admins have been manually creating these jobs already -- a newly-
--    confirmed dispatch item landing on a date that already has a
--    manually-made job for the same order should attach to that one
--    instead of doubling up on the Schedule panel. Only matches by
--    order_no when one is actually given (every dispatch table's order
--    number is NOT NULL in practice, but this guards against ever
--    matching two unrelated blank-order-no jobs against each other).
--    Not granted to anon/authenticated -- only ever called from within
--    the other SECURITY DEFINER functions in this file, which already
--    run as this function's own owner.
-- =========================================================================
create or replace function public.find_or_create_schedule_job(
  p_job_type public.schedule_job_type,
  p_customer_id uuid,
  p_order_no text,
  p_scheduled_date date,
  p_scheduled_time text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if p_order_no is not null and p_order_no <> '' then
    select id into v_job_id
      from public.schedule_jobs
      where job_type = p_job_type
        and status = 'pending'
        and scheduled_date = p_scheduled_date
        and order_no = p_order_no
      limit 1;
  end if;

  if v_job_id is not null then
    return v_job_id;
  end if;

  insert into public.schedule_jobs (job_type, customer_id, order_no, scheduled_date, scheduled_time, status)
  values (p_job_type, p_customer_id, p_order_no, p_scheduled_date, nullif(p_scheduled_time, ''), 'pending')
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- =========================================================================
-- 3. respond_to_dispatch_confirmation() -- same signature as the
--    reschedule_request_with_date migration, body extended to auto-create/
--    link a schedule_jobs row after a successful 'confirm' (never for
--    'reschedule' -- that path doesn't reach Confirmed at all).
-- =========================================================================
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
  v_order_no text;
  v_customer_id uuid;
  v_job_type public.schedule_job_type;
  v_schedule_job_id uuid;
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

  -- Auto-create/link the Schedule panel entry -- only for a genuine
  -- confirm, only once we know a row actually matched.
  if v_updated > 0 and p_action = 'confirm' then
    if v_entity_type = 'filter_change_plans' then
      select order_number, customer_id into v_order_no, v_customer_id from public.filter_change_plans where id = v_entity_id;
      v_job_type := 'filter_change';
    elsif v_entity_type = 'install_plans' then
      select order_no, null into v_order_no, v_customer_id from public.install_plans where id = v_entity_id;
      v_job_type := 'installation';
    elsif v_entity_type = 'collections' then
      select order_no, customer_id into v_order_no, v_customer_id from public.collections where id = v_entity_id;
      v_job_type := 'collection';
    elsif v_entity_type = 'repair_plans' then
      select order_no, null into v_order_no, v_customer_id from public.repair_plans where id = v_entity_id;
      v_job_type := 'repair';
    end if;

    v_schedule_job_id := public.find_or_create_schedule_job(v_job_type, v_customer_id, v_order_no, v_scheduled_date::date, null);

    if v_entity_type = 'filter_change_plans' then
      update public.filter_change_plans set schedule_job_id = v_schedule_job_id where id = v_entity_id;
    elsif v_entity_type = 'install_plans' then
      update public.install_plans set schedule_job_id = v_schedule_job_id where id = v_entity_id;
    elsif v_entity_type = 'collections' then
      update public.collections set schedule_job_id = v_schedule_job_id where id = v_entity_id;
    elsif v_entity_type = 'repair_plans' then
      update public.repair_plans set schedule_job_id = v_schedule_job_id where id = v_entity_id;
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

-- =========================================================================
-- 4. accept_requested_reschedule() -- same signature as the
--    reschedule_request_with_date migration, body extended the same way.
--    scheduled_time gets the customer's own requested_time here (unlike
--    the plain-confirm path above, which has no time at all) -- the
--    perfect match for schedule_jobs' own pre-existing scheduled_time
--    column, both being the exact same "courtesy display" concept.
-- =========================================================================
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
  v_order_no text;
  v_customer_id uuid;
  v_job_type public.schedule_job_type;
  v_schedule_job_id uuid;
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
      returning coalesce(member_account, order_number), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_number, customer_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_customer_id;
    v_job_type := 'filter_change';
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set pre_installed_date = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(name, order_no), pre_installed_date::text, requested_time, notify_phone, notify_email, confirmation_token, order_no
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no;
    v_job_type := 'installation';
  elsif p_entity_type = 'collections' then
    update public.collections
      set pre_d = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_no, customer_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no, v_customer_id;
    v_job_type := 'collection';
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set pre_d = requested_date, dispatch_status = 'Confirmed'
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, confirmation_token, order_no
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_confirmation_token, v_order_no;
    v_job_type := 'repair';
  end if;
  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    v_schedule_job_id := public.find_or_create_schedule_job(v_job_type, v_customer_id, v_order_no, v_scheduled_date::date, v_requested_time);

    if p_entity_type = 'filter_change_plans' then
      update public.filter_change_plans set schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'install_plans' then
      update public.install_plans set schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'collections' then
      update public.collections set schedule_job_id = v_schedule_job_id where id = p_entity_id;
    elsif p_entity_type = 'repair_plans' then
      update public.repair_plans set schedule_job_id = v_schedule_job_id where id = p_entity_id;
    end if;
  end if;

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
