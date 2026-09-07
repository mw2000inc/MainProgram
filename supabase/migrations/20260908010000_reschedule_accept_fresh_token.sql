-- Follow-up to fix_reschedule_accept: confirmation_token still came back
-- null after an accepted reschedule, since reset_dispatch_status_on_pre_d_change
-- clears it (its own documented behavior, unaffected by that migration's
-- fix) whenever pre_d changes — flagged there as a known side effect, not
-- fixed, pending this decision. Confirmed in that migration's own comment
-- and now addressed here: mint a fresh token as part of the *second*
-- statement (dispatch_status = 'Confirmed'), the same statement that
-- already avoids re-triggering the reset (pre_d is untouched there), so
-- the new token survives instead of getting cleared again.
--
-- Token/expiry pattern matches approve_dispatch_item() exactly — the one
-- other place in this app that mints a fresh confirmation token
-- (dispatch_confirmation_workflow migration): gen_random_uuid() for the
-- token, now() + interval '7 days' for its expiry. Same shape, same
-- lifetime, nothing new invented here.
--
-- out_confirmation_token now returns this new token instead of the (now
-- genuinely stale, already-cleared) one read back from the first
-- statement — accept-reschedule/route.ts already builds confirmUrl from
-- whatever out_confirmation_token comes back, so no route change is
-- needed beyond the comment fix called out separately.
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
  v_order_no text;
  v_customer_id uuid;
  v_existing_schedule_job_id uuid;
  v_job_type public.schedule_job_type;
  v_schedule_job_id uuid;
  v_new_token uuid := gen_random_uuid();
  v_updated integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can accept a requested reschedule';
  end if;
  if p_entity_type not in ('filter_change_plans', 'install_plans', 'collections', 'repair_plans') then
    raise exception 'Unknown entity_type: %', p_entity_type;
  end if;

  -- Statement 1 (unchanged from fix_reschedule_accept): only pre_d changes
  -- here, plus whatever reset_dispatch_status_on_pre_d_change itself does
  -- as a side effect (dispatch_status -> Draft, confirmation_token/expiry
  -- -> null). confirmation_token is no longer read out of this statement
  -- at all now — it's stale the instant this statement commits, so there
  -- is nothing useful to capture here anymore.
  if p_entity_type = 'filter_change_plans' then
    update public.filter_change_plans
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(member_account, order_number), pre_d::text, requested_time, notify_phone, notify_email, order_number, customer_id, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_order_no, v_customer_id, v_existing_schedule_job_id;
    v_job_type := 'filter_change';
  elsif p_entity_type = 'install_plans' then
    update public.install_plans
      set pre_installed_date = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(name, order_no), pre_installed_date::text, requested_time, notify_phone, notify_email, order_no, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_order_no, v_existing_schedule_job_id;
    v_job_type := 'installation';
  elsif p_entity_type = 'collections' then
    update public.collections
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, order_no, customer_id, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_order_no, v_customer_id, v_existing_schedule_job_id;
    v_job_type := 'collection';
  elsif p_entity_type = 'repair_plans' then
    update public.repair_plans
      set pre_d = requested_date
      where id = p_entity_id and dispatch_status = 'Reschedule Requested' and requested_date is not null
      returning coalesce(account_name, order_no), pre_d::text, requested_time, notify_phone, notify_email, order_no, schedule_job_id
      into v_label, v_scheduled_date, v_requested_time, v_notify_phone, v_notify_email, v_order_no, v_existing_schedule_job_id;
    v_job_type := 'repair';
  end if;
  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    -- Unchanged from fix_reschedule_accept (Bug #1's fix).
    if v_existing_schedule_job_id is not null then
      update public.schedule_jobs
        set scheduled_date = v_scheduled_date::date,
          scheduled_time = nullif(v_requested_time, '')
        where id = v_existing_schedule_job_id;
      v_schedule_job_id := v_existing_schedule_job_id;
    else
      v_schedule_job_id := public.find_or_create_schedule_job(v_job_type, v_customer_id, v_order_no, v_scheduled_date::date, v_requested_time);
    end if;

    -- Statement 2: dispatch_status, schedule_job_id, AND the fresh token +
    -- expiry, all together — pre_d still untouched here, so
    -- reset_dispatch_status_on_pre_d_change still doesn't fire and none of
    -- this gets clobbered the way the first statement's own token was.
    if p_entity_type = 'filter_change_plans' then
      update public.filter_change_plans
        set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id,
          confirmation_token = v_new_token, confirmation_token_expires_at = now() + interval '7 days'
        where id = p_entity_id;
    elsif p_entity_type = 'install_plans' then
      update public.install_plans
        set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id,
          confirmation_token = v_new_token, confirmation_token_expires_at = now() + interval '7 days'
        where id = p_entity_id;
    elsif p_entity_type = 'collections' then
      update public.collections
        set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id,
          confirmation_token = v_new_token, confirmation_token_expires_at = now() + interval '7 days'
        where id = p_entity_id;
    elsif p_entity_type = 'repair_plans' then
      update public.repair_plans
        set dispatch_status = 'Confirmed', schedule_job_id = v_schedule_job_id,
          confirmation_token = v_new_token, confirmation_token_expires_at = now() + interval '7 days'
        where id = p_entity_id;
    end if;
  end if;

  out_ok := v_updated > 0;
  out_label := v_label;
  out_scheduled_date := v_scheduled_date;
  out_requested_time := v_requested_time;
  out_notify_phone := v_notify_phone;
  out_notify_email := v_notify_email;
  -- Only a genuine accept gets the new token back — a no-op call (v_updated = 0,
  -- e.g. the record wasn't actually in 'Reschedule Requested') correctly
  -- returns null here rather than a token that was never actually written
  -- to any row.
  out_confirmation_token := case when v_updated > 0 then v_new_token else null end;
  return next;
end;
$$;
