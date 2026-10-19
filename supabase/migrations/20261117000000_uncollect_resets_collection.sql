-- Setting a collection back to Pending ("not collected") really un-collects
-- it: it leaves the technician's Release Slip and its Acc D is cleared.
--
-- Why: changing the Status to Pending changed only the status — collected
-- stayed true, Acc D kept the collected day and its schedule job stayed
-- completed, so the Release Slip still printed "Collected: ₱14,400.00" and
-- the Daily Report still showed the Acc D.
--
-- 1. BEFORE UPDATE (reset_uncollected_collection): status set to Pending
--    (from anything else) -> collected = false, acc_d = null. Unticking
--    "collected" on a Collected row (All Collection) also sets it Pending.
--    Collected by / Collected at stay, so ticking it again restores the
--    original credit (the All Collection rule).
-- 2. AFTER UPDATE (sync_uncollect_to_job): a collection that was collected
--    and no longer is -> its schedule job, if completed, goes back to
--    pending, so it leaves the Release Slip (which lists completed jobs;
--    "Include pending jobs" still shows it as "To Collect").
-- 3. One-time fix: the 5 collections already set to Pending while still
--    marked collected (001-0440, 0441, 0616, 0617, 0159 — Oct 16) get the
--    same reset, and their jobs go back to pending.

create or replace function public.reset_uncollected_collection()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.status = 'Pending' and OLD.status is distinct from 'Pending' then
    NEW.collected := false;
    NEW.acc_d := null;
  elsif NEW.status = 'Collected' and OLD.status = 'Collected'
        and coalesce(OLD.collected, false) and not coalesce(NEW.collected, false) then
    NEW.status := 'Pending';
    NEW.acc_d := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_reset_uncollected_collection on public.collections;
create trigger trg_reset_uncollected_collection
  before update on public.collections
  for each row execute function public.reset_uncollected_collection();

create or replace function public.sync_uncollect_to_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;
  if (OLD.status = 'Collected' or coalesce(OLD.collected, false))
     and not (NEW.status = 'Collected' or coalesce(NEW.collected, false))
     and NEW.status <> 'Cancelled' then
    update public.schedule_jobs
      set status = 'pending'
      where id = NEW.schedule_job_id and status::text = 'completed' and job_type::text = 'collection';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_uncollect_to_job on public.collections;
create trigger trg_sync_uncollect_to_job
  after update of status, collected on public.collections
  for each row execute function public.sync_uncollect_to_job();

-- 3. One-time fix of the rows already in that state.
with stale as (
  select id, schedule_job_id from public.collections
  where status = 'Pending' and coalesce(collected, false)
), fixed as (
  update public.collections c
    set collected = false, acc_d = null
    from stale s
    where c.id = s.id
    returning c.schedule_job_id
)
update public.schedule_jobs j
  set status = 'pending'
  from fixed f
  where j.id = f.schedule_job_id and j.status::text = 'completed' and j.job_type::text = 'collection';
