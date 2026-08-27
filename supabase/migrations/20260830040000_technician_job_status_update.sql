-- Lets a technician mark their own assigned schedule_jobs row done (or
-- otherwise update its status/remarks) from the Schedule panel, narrowly
-- scoped so this can't be used to edit anything else about the job —
-- reassigning technicians, changing the date, etc. stays admin-only exactly
-- as schedule_jobs_write_admin/schedule_jobs_update_admin (see
-- 20260824020000) already locked down.
--
-- RLS alone can gate which ROWS a technician may touch (their own assigned
-- job), but not which COLUMNS within an allowed row — that needs a trigger,
-- since Postgres has no per-row column-level privilege concept. The trigger
-- below does the generic "diff everything except the allowed columns"
-- check, the same style already used by log_audit_event() for its
-- before/after diff, rather than hardcoding schedule_jobs' full column list
-- (which would silently stop protecting a column added to the table later).
--
-- The existing trg_audit_log trigger (from the audit_logging migration)
-- already fires on this table for every update regardless of who made it,
-- so a technician's status change is automatically captured in
-- activity_logs with no further change here — see the Technician Activity
-- page, which reads the same table filtered to technician-authored rows.

drop policy if exists "schedule_jobs_update_admin" on public.schedule_jobs;
create policy "schedule_jobs_update" on public.schedule_jobs
  for update to authenticated
  using (public.is_admin() or technician_user_id = auth.uid() or technician_2_user_id = auth.uid());

create or replace function public.restrict_schedule_job_technician_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if not public.is_admin() then
    v_old := to_jsonb(OLD) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    v_new := to_jsonb(NEW) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    if v_old is distinct from v_new then
      raise exception 'Technicians may only update a job''s status and remarks';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_restrict_technician_update on public.schedule_jobs;
create trigger trg_restrict_technician_update before update on public.schedule_jobs
  for each row execute function public.restrict_schedule_job_technician_update();
