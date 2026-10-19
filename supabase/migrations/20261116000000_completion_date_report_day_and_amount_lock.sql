-- Completion date = the day of the Daily Report / job it was completed on,
-- and a collection's amount can't change once it's being collected.
--
-- 1. completion_date_from_pre_d (20261115000000) always replaced Acc D /
--    Installed Date with Pre D on completion. Now a date sent WITH the
--    completion is kept — the Daily Report sends the date being viewed, the
--    Release Slip its slip date, a schedule job its own date — and only when
--    none is sent does Pre D (else the job's date) fill it. So a Filter
--    Change shown on the Oct 15 report and ticked Completed on Oct 19 gets
--    Acc D Oct 15.
--
-- 2. sync_job_completion_to_records (20261027000000): completing a job filled
--    an empty Acc D / Installed Date / collection Acc D with TODAY. It now
--    uses the job's own scheduled date (the Daily Report day it's on), today
--    only when the job has none. Otherwise unchanged.
--
-- 3. Collections: the amount is the one the admin set on the plan. When a
--    collection is being marked Collected, or already is, an amount change in
--    the same update is ignored (the old amount stays). Editing the amount of
--    a still-pending collection is unchanged.
--
-- Running this changes no existing rows: it redefines two functions and adds
-- one function + trigger.

-- =========================================================================
-- 1. A date sent with the completion wins over Pre D
-- =========================================================================
create or replace function public.completion_date_from_pre_d()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_done boolean;
  v_was_done boolean;
  v_day date;
  v_given date;
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

  -- The date sent in this same update (Daily Report day, slip date, job date).
  if TG_TABLE_NAME = 'install_plans' then
    if NEW.installed_date is distinct from OLD.installed_date then v_given := NEW.installed_date; end if;
  else
    if NEW.acc_d is distinct from OLD.acc_d then v_given := NEW.acc_d; end if;
  end if;
  if v_given is not null then
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

-- =========================================================================
-- 2. Completing a job dates its records on the job's own day
-- =========================================================================
create or replace function public.sync_job_completion_to_records()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_day date := coalesce(NEW.scheduled_date, (now() at time zone 'Asia/Manila')::date);
begin
  if NEW.status <> 'completed' or OLD.status = 'completed' then
    return null;
  end if;

  update public.filter_change_plans
    set status = 'Completed', acc_d = coalesce(acc_d, v_day)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  update public.install_plans
    set status = 'Completed', installed_date = coalesce(installed_date, v_day)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  update public.repair_plans
    set status = 'Completed', acc_d = coalesce(acc_d, v_day)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');

  if NEW.job_type::text = 'collection' then
    update public.collections
      set status = 'Collected',
        collected = true,
        collected_by = coalesce(collected_by, auth.uid()),
        collected_at = coalesce(collected_at, now()),
        acc_d = coalesce(acc_d, v_day)
      where schedule_job_id = NEW.id
        and status <> 'Cancelled'
        and not (status = 'Collected' and collected);
  end if;

  return null;
end;
$$;

-- =========================================================================
-- 3. A collection's amount stays as set while / after it's collected
-- =========================================================================
create or replace function public.lock_collection_amount()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.amount is distinct from OLD.amount
     and (NEW.status = 'Collected' or coalesce(NEW.collected, false)
          or OLD.status = 'Collected' or coalesce(OLD.collected, false)) then
    NEW.amount := OLD.amount;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_lock_collection_amount on public.collections;
create trigger trg_lock_collection_amount
  before update on public.collections
  for each row execute function public.lock_collection_amount();
