-- Keeps a visit record and its schedule job on the same date in BOTH
-- directions.
--
-- Job -> record already exists (sync_schedule_job_changes_to_module,
-- 20261020000000): moving a job — inline in the Schedule, in the month
-- approval review, or a job created from a visit and moved — re-dates its
-- linked Filter Change / install / repair / collection record.
--
-- Record -> job did not: re-dating the record itself (Pre D on the Filter
-- Change page or the Daily Report widget, Pre-Installed Date, a reschedule
-- the customer asked for, or the CP cycle re-pacing a Pending visit after
-- its order's CP System / CP Start changes) left the linked job on the old
-- date. Now, when a record's effective date — its rescheduled date, else its
-- base date — changes, its still-open job ('pending' / 'pending_approval')
-- moves to that date. A done record or a completed / cancelled job is left
-- alone.
--
-- No loop: each side only writes when the other's date actually differs,
-- and the job -> record trigger fires only on a real change of the job's
-- date, so a move made on either side settles after one round trip.
-- Technician changes still flow job -> record only (as before).

create or replace function public.sync_module_date_to_schedule_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old date;
  v_new date;
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;

  if TG_TABLE_NAME = 'filter_change_plans' then
    v_old := coalesce(OLD.pre_d, OLD.plan_date);
    v_new := coalesce(NEW.pre_d, NEW.plan_date);
  elsif TG_TABLE_NAME = 'install_plans' then
    v_old := coalesce(OLD.pre_installed_date, OLD.input_date);
    v_new := coalesce(NEW.pre_installed_date, NEW.input_date);
  elsif TG_TABLE_NAME = 'collections' then
    v_old := coalesce(OLD.pre_d, OLD.collection_date);
    v_new := coalesce(NEW.pre_d, NEW.collection_date);
  elsif TG_TABLE_NAME = 'repair_plans' then
    v_old := coalesce(OLD.pre_d, OLD.issued_date);
    v_new := coalesce(NEW.pre_d, NEW.issued_date);
  else
    return null;
  end if;

  if v_new is null or v_new is not distinct from v_old then
    return null;
  end if;
  if NEW.status in ('Completed', 'Collected', 'Cancelled') then
    return null;
  end if;

  update public.schedule_jobs
    set scheduled_date = v_new
    where id = NEW.schedule_job_id
      and status in ('pending', 'pending_approval')
      and scheduled_date is distinct from v_new;
  return null;
end;
$$;

drop trigger if exists trg_sync_module_date_to_schedule_job on public.filter_change_plans;
create trigger trg_sync_module_date_to_schedule_job
  after update of pre_d, plan_date on public.filter_change_plans
  for each row execute function public.sync_module_date_to_schedule_job();

drop trigger if exists trg_sync_module_date_to_schedule_job on public.install_plans;
create trigger trg_sync_module_date_to_schedule_job
  after update of pre_installed_date, input_date on public.install_plans
  for each row execute function public.sync_module_date_to_schedule_job();

drop trigger if exists trg_sync_module_date_to_schedule_job on public.collections;
create trigger trg_sync_module_date_to_schedule_job
  after update of pre_d, collection_date on public.collections
  for each row execute function public.sync_module_date_to_schedule_job();

drop trigger if exists trg_sync_module_date_to_schedule_job on public.repair_plans;
create trigger trg_sync_module_date_to_schedule_job
  after update of pre_d, issued_date on public.repair_plans
  for each row execute function public.sync_module_date_to_schedule_job();
