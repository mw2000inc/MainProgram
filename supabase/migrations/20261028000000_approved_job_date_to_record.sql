-- An approved schedule job's date becomes its linked visit record's date
-- (Pre D; Pre-Installed Date for installs), so the record shows on the Daily
-- Report's Filter Change / Collection / Install / Repair panel on the same day
-- the job shows in the Schedule panel.
--
-- Why: those panels pick a record by its OWN date (Pre D, else its base
-- date); the Schedule panel lists jobs by the JOB's date. The two only agreed
-- when the job was moved later (sync_schedule_job_changes_to_module,
-- 20261020000000) or when the database linked a job to an existing record
-- itself (ensure_schedule_job_module_record). A job created with a different
-- date and linked straight away — e.g. the draft generator, which dates an
-- already-past visit's job today and then links the visit — left the record
-- on its old date, so approved jobs showed in the Schedule panel but their
-- records stayed off the other panels (checked live: 22 jobs on Oct 9, 2026).
--
-- Now:
-- 1. When a job BECOMES approved (from 'pending_approval' or any other
--    unapproved status to 'pending' or 'completed'), each linked record of
--    the job's own type whose date differs gets the job's date.
-- 2. When a record is linked to (or inserted with) a job that is ALREADY
--    approved, that record gets the job's date the same way.
-- Afterwards, moving the job keeps moving the record (the existing
-- 20261020 sync), and moving the record moves the job (20261025).
--
-- Skipped: Reschedule Requested records (the customer asked for another
-- date; a Pre D change would also reset them to Draft — that stays an admin
-- decision), and anything already done (Completed / Collected / Cancelled).
-- Only records of the job's own type follow, the same rule the existing
-- job -> record date sync uses (a filter change job moves its Filter Change
-- record, not a collection linked to it).
--
-- Side effects, same as any Pre D edit: the "two-day reminder sent" flag
-- resets (reset_two_day_reminder_on_date_change), so the reminder follows the
-- new date; a Pending Customer Confirmation record is already Confirmed by
-- then (20261026's triggers run first on approval and at link time), so the
-- dispatch reset on a Pre D change doesn't apply to it.
--
-- No loop: the Pre D update fires the record -> job date sync (20261025),
-- which only writes when the job's date differs — it doesn't, so it stops.
-- The link trigger updates only Pre D, never schedule_job_id, so it doesn't
-- re-fire itself.
--
-- Running this changes no existing rows: it only creates new functions and
-- triggers (it redefines nothing, including nothing from 20261015000000,
-- 20261026000000 or 20261027000000). Records already linked to an approved
-- job on a different date are NOT backfilled.

-- =========================================================================
-- Shared: give one job's date to its linked records of the job's own type
-- (or, with p_record_id, to that one record only).
-- =========================================================================
create or replace function public.apply_approved_job_date(p_job_id uuid, p_record_id uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_date date;
  v_type text;
begin
  select scheduled_date, job_type::text into v_date, v_type
    from public.schedule_jobs
    where id = p_job_id and status::text in ('pending', 'completed');
  if v_date is null then
    return;
  end if;

  if v_type = 'filter_change' then
    update public.filter_change_plans set pre_d = v_date
      where schedule_job_id = p_job_id
        and (p_record_id is null or id = p_record_id)
        and status not in ('Completed', 'Cancelled')
        and dispatch_status is distinct from 'Reschedule Requested'
        and coalesce(pre_d, plan_date) is distinct from v_date;
  elsif v_type = 'installation' then
    update public.install_plans set pre_installed_date = v_date
      where schedule_job_id = p_job_id
        and (p_record_id is null or id = p_record_id)
        and status not in ('Completed', 'Cancelled')
        and dispatch_status is distinct from 'Reschedule Requested'
        and coalesce(pre_installed_date, input_date) is distinct from v_date;
  elsif v_type = 'repair' then
    update public.repair_plans set pre_d = v_date
      where schedule_job_id = p_job_id
        and (p_record_id is null or id = p_record_id)
        and status not in ('Completed', 'Cancelled')
        and dispatch_status is distinct from 'Reschedule Requested'
        and coalesce(pre_d, issued_date) is distinct from v_date;
  elsif v_type = 'collection' then
    update public.collections set pre_d = v_date
      where schedule_job_id = p_job_id
        and (p_record_id is null or id = p_record_id)
        and status not in ('Collected', 'Completed', 'Cancelled')
        and not coalesce(collected, false)
        and dispatch_status is distinct from 'Reschedule Requested'
        and coalesce(pre_d, collection_date) is distinct from v_date;
  end if;
end;
$$;

-- =========================================================================
-- 1. A job becomes approved
-- =========================================================================
create or replace function public.sync_approved_job_date_to_records()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.status::text not in ('pending', 'completed') or OLD.status::text in ('pending', 'completed') then
    return null;
  end if;
  perform public.apply_approved_job_date(NEW.id);
  return null;
end;
$$;

drop trigger if exists trg_sync_approved_job_date_to_records on public.schedule_jobs;
create trigger trg_sync_approved_job_date_to_records
  after update of status on public.schedule_jobs
  for each row execute function public.sync_approved_job_date_to_records();

-- =========================================================================
-- 2. A record is linked to an already-approved job
-- =========================================================================
create or replace function public.sync_record_link_to_approved_job_date()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;
  if TG_OP = 'UPDATE' and NEW.schedule_job_id is not distinct from OLD.schedule_job_id then
    return null;
  end if;
  perform public.apply_approved_job_date(NEW.schedule_job_id, NEW.id);
  return null;
end;
$$;

drop trigger if exists trg_sync_record_link_to_approved_job_date on public.filter_change_plans;
create trigger trg_sync_record_link_to_approved_job_date
  after insert or update of schedule_job_id on public.filter_change_plans
  for each row execute function public.sync_record_link_to_approved_job_date();

drop trigger if exists trg_sync_record_link_to_approved_job_date on public.install_plans;
create trigger trg_sync_record_link_to_approved_job_date
  after insert or update of schedule_job_id on public.install_plans
  for each row execute function public.sync_record_link_to_approved_job_date();

drop trigger if exists trg_sync_record_link_to_approved_job_date on public.repair_plans;
create trigger trg_sync_record_link_to_approved_job_date
  after insert or update of schedule_job_id on public.repair_plans
  for each row execute function public.sync_record_link_to_approved_job_date();

drop trigger if exists trg_sync_record_link_to_approved_job_date on public.collections;
create trigger trg_sync_record_link_to_approved_job_date
  after insert or update of schedule_job_id on public.collections
  for each row execute function public.sync_record_link_to_approved_job_date();
