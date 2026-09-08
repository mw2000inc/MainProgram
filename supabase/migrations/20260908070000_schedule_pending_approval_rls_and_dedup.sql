-- Admin Schedule Approval workflow, part 2 of 2 -- must run AFTER
-- 20260908060000 has committed (see that file's own comment on why this
-- couldn't be one migration). References 'pending_approval' in three
-- places, none of which touch the RLS lock-down migration
-- (20260908050000_lock_down_remaining_writable_tables.sql, left completely
-- untouched) or either Smart Scheduling migration
-- (20260908020000_smart_schedule_assignment_columns.sql,
-- 20260908030000_allow_backend_schedule_job_assignment.sql).
--
-- =========================================================================
-- 1. schedule_jobs_select -- technicians must not be able to read a
--    pending-approval row at all, not just have it hidden by the UI.
--    Current policy (technician_readonly_daily_report_and_second_link):
--    is_admin() OR technician_user_id = auth.uid() OR technician_2_user_id
--    = auth.uid() -- no status check at all, so a technician account
--    linked at creation time (via the Technician Account field on
--    ScheduleFormDialog) could already read a still-pending-approval row
--    today. Admin access (is_admin()) is completely untouched -- it's the
--    first condition of the OR, evaluated independently of status.
-- =========================================================================
drop policy if exists "schedule_jobs_select" on public.schedule_jobs;
create policy "schedule_jobs_select" on public.schedule_jobs for select to authenticated
  using (
    public.is_admin()
    or (
      status <> 'pending_approval'
      and (technician_user_id = auth.uid() or technician_2_user_id = auth.uid())
    )
  );

-- =========================================================================
-- 2. restrict_schedule_job_technician_update -- a linked technician must
--    not be able to touch a pending-approval row at all (not even the
--    status/remarks columns this trigger otherwise allows them), since
--    only an admin should ever interact with a not-yet-approved schedule.
--    Checked OLD.status (the row's status before this update), not
--    NEW.status -- this blocks a technician from touching the row while
--    it's still pending approval; it does not block the row itself from
--    ever being approved (that update always comes from an admin session,
--    which skips this whole branch already, same as before).
--
--    The existing auth.uid() is not null exemption (added by
--    allow_backend_schedule_job_assignment for the Smart Scheduling
--    automation's own service-role write) is unchanged -- a service-role
--    caller (auth.uid() is null) still bypasses this entire function
--    exactly as before; this only adds a new condition inside the
--    already-existing "real technician session" branch.
-- =========================================================================
create or replace function public.restrict_schedule_job_technician_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if not public.is_admin() and auth.uid() is not null then
    if OLD.status = 'pending_approval' then
      raise exception 'Only an admin can modify a schedule that is still pending approval';
    end if;
    v_old := to_jsonb(OLD) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    v_new := to_jsonb(NEW) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    if v_old is distinct from v_new then
      raise exception 'Technicians may only update a job''s status and remarks';
    end if;
  end if;
  return NEW;
end;
$$;

-- =========================================================================
-- 3. find_or_create_schedule_job -- its duplicate-prevention lookup only
--    ever matched status = 'pending'. A manually-created job now starts
--    at 'pending_approval' instead, so if a customer's dispatch confirm
--    (or a reschedule accept) ever lands on the exact same job_type +
--    order_no + date as an admin's still-unapproved manual schedule, this
--    lookup would miss it and insert a second, duplicate schedule_jobs
--    row instead of reusing the one already sitting there awaiting
--    approval -- exactly the duplication this whole app has repeatedly
--    been fixed to prevent. Widening the match to either status closes
--    that gap. The function's own INSERT (the "not found" branch) is
--    UNCHANGED -- still always inserts 'pending', since a genuine customer
--    confirmation is already its own approval step and has no reason to
--    land in pending_approval.
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
        and status in ('pending', 'pending_approval')
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
