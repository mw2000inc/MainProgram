-- A record gets its job's Serviceman / TH the moment it's linked to it.
--
-- Job → record already syncs when a job's technician CHANGES
-- (sync_schedule_job_changes_to_module, 20261020000000). But a draft is made
-- WITH its technician (the nightly draft run's automatic assignment, Approve
-- All & Dispatch, an Add form's draft) and only then linked to its Filter
-- Change / Installation / Collection / Repair record — so the record's
-- Serviceman stayed empty while Pending Schedule Approval showed a technician
-- (51 Filter Changes and 11 Collections on 2026-10-13).
--
-- 1. On linking (schedule_job_id set on insert or update), an open record
--    gets the job's technician pair when the job has an assigned technician
--    (not blank, not "N/A"). A job without one leaves the record as it is.
-- 2. Backfill: open, job-linked records with an empty Serviceman / TH get
--    their open job's technician pair. A record that already has a Serviceman
--    is left alone.
--
-- Record → job (a Serviceman typed on the record reaching its job, with the
-- crew rule and the technicians' logins) is done by the app on save
-- (syncRecordTechniciansToJob), since name → login matching and the fixed
-- crews live there.

create or replace function public.apply_job_technician_to_linked_record()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  t1 text;
  t2 text;
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;
  if TG_OP = 'UPDATE' and OLD.schedule_job_id is not distinct from NEW.schedule_job_id then
    return null;
  end if;

  select coalesce(trim(technician), ''), coalesce(trim(technician_2), '')
    into t1, t2
    from public.schedule_jobs
    where id = NEW.schedule_job_id
      and status::text in ('pending', 'pending_approval', 'completed');
  if t1 is null or t1 = '' or upper(t1) = 'N/A' then
    return null;
  end if;
  if upper(t2) = 'N/A' then
    t2 := '';
  end if;

  if TG_TABLE_NAME = 'filter_change_plans' then
    update public.filter_change_plans set serviceman = t1, serviceman_2 = t2
      where id = NEW.id and status not in ('Completed', 'Cancelled')
        and (serviceman is distinct from t1 or coalesce(serviceman_2, '') is distinct from t2);
  elsif TG_TABLE_NAME = 'install_plans' then
    update public.install_plans set serviceman = t1, serviceman_2 = t2
      where id = NEW.id and status not in ('Completed', 'Cancelled')
        and (serviceman is distinct from t1 or coalesce(serviceman_2, '') is distinct from t2);
  elsif TG_TABLE_NAME = 'repair_plans' then
    update public.repair_plans set th = t1, th_2 = t2
      where id = NEW.id and status not in ('Completed', 'Cancelled')
        and (th is distinct from t1 or coalesce(th_2, '') is distinct from t2);
  elsif TG_TABLE_NAME = 'collections' then
    update public.collections set serviceman = t1, serviceman_2 = t2
      where id = NEW.id and status not in ('Collected', 'Completed', 'Cancelled') and not coalesce(collected, false)
        and (serviceman is distinct from t1 or coalesce(serviceman_2, '') is distinct from t2);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_apply_job_technician_to_linked_record on public.filter_change_plans;
create trigger trg_apply_job_technician_to_linked_record
  after insert or update of schedule_job_id on public.filter_change_plans
  for each row execute function public.apply_job_technician_to_linked_record();

drop trigger if exists trg_apply_job_technician_to_linked_record on public.install_plans;
create trigger trg_apply_job_technician_to_linked_record
  after insert or update of schedule_job_id on public.install_plans
  for each row execute function public.apply_job_technician_to_linked_record();

drop trigger if exists trg_apply_job_technician_to_linked_record on public.repair_plans;
create trigger trg_apply_job_technician_to_linked_record
  after insert or update of schedule_job_id on public.repair_plans
  for each row execute function public.apply_job_technician_to_linked_record();

drop trigger if exists trg_apply_job_technician_to_linked_record on public.collections;
create trigger trg_apply_job_technician_to_linked_record
  after insert or update of schedule_job_id on public.collections
  for each row execute function public.apply_job_technician_to_linked_record();

-- 2. Backfill: empty Serviceman / TH on open, job-linked records.
with job as (
  select id, trim(technician) as t1,
         case when upper(coalesce(trim(technician_2), '')) = 'N/A' then '' else coalesce(trim(technician_2), '') end as t2
  from public.schedule_jobs
  where status::text in ('pending', 'pending_approval')
    and coalesce(trim(technician), '') <> '' and upper(trim(technician)) <> 'N/A'
)
update public.filter_change_plans p set serviceman = j.t1, serviceman_2 = j.t2
  from job j
  where p.schedule_job_id = j.id and p.status not in ('Completed', 'Cancelled')
    and (coalesce(trim(p.serviceman), '') = '' or upper(trim(p.serviceman)) = 'N/A');

with job as (
  select id, trim(technician) as t1,
         case when upper(coalesce(trim(technician_2), '')) = 'N/A' then '' else coalesce(trim(technician_2), '') end as t2
  from public.schedule_jobs
  where status::text in ('pending', 'pending_approval')
    and coalesce(trim(technician), '') <> '' and upper(trim(technician)) <> 'N/A'
)
update public.install_plans p set serviceman = j.t1, serviceman_2 = j.t2
  from job j
  where p.schedule_job_id = j.id and p.status not in ('Completed', 'Cancelled')
    and (coalesce(trim(p.serviceman), '') = '' or upper(trim(p.serviceman)) = 'N/A');

with job as (
  select id, trim(technician) as t1,
         case when upper(coalesce(trim(technician_2), '')) = 'N/A' then '' else coalesce(trim(technician_2), '') end as t2
  from public.schedule_jobs
  where status::text in ('pending', 'pending_approval')
    and coalesce(trim(technician), '') <> '' and upper(trim(technician)) <> 'N/A'
)
update public.repair_plans p set th = j.t1, th_2 = j.t2
  from job j
  where p.schedule_job_id = j.id and p.status not in ('Completed', 'Cancelled')
    and (coalesce(trim(p.th), '') = '' or upper(trim(p.th)) = 'N/A');

with job as (
  select id, trim(technician) as t1,
         case when upper(coalesce(trim(technician_2), '')) = 'N/A' then '' else coalesce(trim(technician_2), '') end as t2
  from public.schedule_jobs
  where status::text in ('pending', 'pending_approval')
    and coalesce(trim(technician), '') <> '' and upper(trim(technician)) <> 'N/A'
)
update public.collections p set serviceman = j.t1, serviceman_2 = j.t2
  from job j
  where p.schedule_job_id = j.id and p.status not in ('Collected', 'Completed', 'Cancelled') and not coalesce(p.collected, false)
    and (coalesce(trim(p.serviceman), '') = '' or upper(trim(p.serviceman)) = 'N/A');
