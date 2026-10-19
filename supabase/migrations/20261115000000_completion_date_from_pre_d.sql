-- When a visit is completed, its completion date is the day it was planned
-- for (Pre D), not the day someone marked it done.
--
-- Why: a visit with Pre D Oct 16 that an admin marks done on Oct 19 got
-- Acc D Oct 19 (sync_job_completion_to_records fills an empty Acc D with
-- today, and the pages do the same), so its filters were dated Oct 19 and
-- the visit read as done on the wrong day.
--
-- Rule, on the change INTO completed only (status becomes 'Completed', or
-- for a collection 'Collected'):
--   Filter Change / Repair / Collection -> acc_d = pre_d
--   Installation                        -> installed_date = pre_installed_date
-- When the record has no Pre D, its schedule job's date is used; with
-- neither, whatever was given (today) stays. Later edits of Acc D /
-- Installed Date on an already-completed record are left alone.
--
-- A BEFORE trigger, so the inventory-queue triggers (AFTER) already see the
-- corrected date and date the queued filters / unit on the Pre D day.
--
-- Also (second part below): cancelling a record cancels its open job, so it
-- leaves the Release Slip and the schedule.
--
-- Running this changes no existing rows: it only adds two functions and
-- their triggers. Records already completed keep their current dates.

create or replace function public.completion_date_from_pre_d()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_done boolean;
  v_was_done boolean;
  v_day date;
begin
  if TG_TABLE_NAME = 'collections' then
    v_done := NEW.status = 'Collected' or coalesce(NEW.collected, false);
    v_was_done := OLD.status = 'Collected' or coalesce(OLD.collected, false);
  else
    v_done := NEW.status = 'Completed';
    v_was_done := OLD.status = 'Completed';
  end if;
  if not v_done or v_was_done then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'install_plans' then
    v_day := NEW.pre_installed_date;
  else
    v_day := NEW.pre_d;
  end if;
  if v_day is null and NEW.schedule_job_id is not null then
    select scheduled_date into v_day from public.schedule_jobs where id = NEW.schedule_job_id;
  end if;
  if v_day is null then
    return NEW;
  end if;

  if TG_TABLE_NAME = 'install_plans' then
    NEW.installed_date := v_day;
  else
    NEW.acc_d := v_day;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_completion_date_from_pre_d on public.filter_change_plans;
create trigger trg_completion_date_from_pre_d
  before update on public.filter_change_plans
  for each row execute function public.completion_date_from_pre_d();

drop trigger if exists trg_completion_date_from_pre_d on public.repair_plans;
create trigger trg_completion_date_from_pre_d
  before update on public.repair_plans
  for each row execute function public.completion_date_from_pre_d();

drop trigger if exists trg_completion_date_from_pre_d on public.install_plans;
create trigger trg_completion_date_from_pre_d
  before update on public.install_plans
  for each row execute function public.completion_date_from_pre_d();

drop trigger if exists trg_completion_date_from_pre_d on public.collections;
create trigger trg_completion_date_from_pre_d
  before update on public.collections
  for each row execute function public.completion_date_from_pre_d();

-- =========================================================================
-- Cancelling a record cancels its open schedule job
-- =========================================================================
-- A record set to 'Cancelled' (e.g. from the Daily Report) left its job
-- 'pending', so the visit stayed on the Release Slip and the technician's
-- schedule. Now its job — if still 'pending' or a draft — becomes
-- 'cancelled'; taking the record out of Cancelled again puts a job this
-- rule cancelled back to 'pending'. A completed job is never touched.

create or replace function public.sync_record_cancel_to_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.schedule_job_id is null or NEW.status is not distinct from OLD.status then
    return null;
  end if;
  if NEW.status = 'Cancelled' then
    update public.schedule_jobs
      set status = 'cancelled'
      where id = NEW.schedule_job_id and status::text in ('pending', 'pending_approval');
  elsif OLD.status = 'Cancelled' then
    update public.schedule_jobs
      set status = 'pending'
      where id = NEW.schedule_job_id and status::text = 'cancelled';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_record_cancel_to_job on public.filter_change_plans;
create trigger trg_sync_record_cancel_to_job
  after update of status on public.filter_change_plans
  for each row execute function public.sync_record_cancel_to_job();

drop trigger if exists trg_sync_record_cancel_to_job on public.repair_plans;
create trigger trg_sync_record_cancel_to_job
  after update of status on public.repair_plans
  for each row execute function public.sync_record_cancel_to_job();

drop trigger if exists trg_sync_record_cancel_to_job on public.install_plans;
create trigger trg_sync_record_cancel_to_job
  after update of status on public.install_plans
  for each row execute function public.sync_record_cancel_to_job();

drop trigger if exists trg_sync_record_cancel_to_job on public.collections;
create trigger trg_sync_record_cancel_to_job
  after update of status on public.collections
  for each row execute function public.sync_record_cancel_to_job();
