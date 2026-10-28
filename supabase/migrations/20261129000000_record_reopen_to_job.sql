-- A visit set back to Pending reopens its schedule job, so the technician
-- sees it as pending again.
--
-- Why: completing or cancelling a Filter Change / Installation / Repair
-- already reaches its job (sync_record_completion_to_job 20261027000000,
-- sync_record_cancel_to_job 20261115000000), but changing it BACK from
-- Completed to Pending (e.g. on the Daily Report) left the job Completed —
-- 001-1090's installation was reopened on Oct 28 and still showed Completed
-- on the technician's Schedule. Collections already do this
-- (sync_uncollect_to_job, 20261117000000).
--
-- Now: Completed → Pending on the record sets its completed job (same type)
-- back to 'pending'. Nothing else about the job changes.
--
-- Running this adds one function and three triggers, and reopens 001-1090's
-- job (the one-time fix at the end).

create or replace function public.sync_record_reopen_to_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_type text := case TG_TABLE_NAME
    when 'filter_change_plans' then 'filter_change'
    when 'install_plans' then 'installation'
    when 'repair_plans' then 'repair'
  end;
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;
  if OLD.status = 'Completed' and NEW.status = 'Pending' then
    update public.schedule_jobs
      set status = 'pending'
      where id = NEW.schedule_job_id and status::text = 'completed' and job_type::text = v_job_type;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_record_reopen_to_job on public.filter_change_plans;
create trigger trg_sync_record_reopen_to_job
  after update of status on public.filter_change_plans
  for each row execute function public.sync_record_reopen_to_job();

drop trigger if exists trg_sync_record_reopen_to_job on public.install_plans;
create trigger trg_sync_record_reopen_to_job
  after update of status on public.install_plans
  for each row execute function public.sync_record_reopen_to_job();

drop trigger if exists trg_sync_record_reopen_to_job on public.repair_plans;
create trigger trg_sync_record_reopen_to_job
  after update of status on public.repair_plans
  for each row execute function public.sync_record_reopen_to_job();

-- One-time fix: 001-1090's installation was set back to Pending on Oct 28,
-- before this rule existed — its job (still 'completed') is reopened so the
-- technician sees it as pending. Only that one job, and only while its
-- installation is still Pending.
update public.schedule_jobs j
set status = 'pending'
where j.id = 'c8e83301-4578-4722-80aa-2f20ddc81b06'
  and j.status::text = 'completed'
  and exists (
    select 1 from public.install_plans i
    where i.schedule_job_id = j.id and i.status = 'Pending'
  );
