-- Fix: completing an Installation failed with
--   record "new" has no field "pre_d"
--
-- Why: 20261118000000 checked `TG_TABLE_NAME = 'filter_change_plans' and
-- NEW.pre_d is not null` in one condition. PL/pgSQL doesn't skip the second
-- half when the first is false, so on install_plans (which has
-- pre_installed_date, not pre_d) it looked up NEW.pre_d and raised — every
-- install completion (Schedule "Mark as Completed", Daily Report tick, job
-- approval) was rolled back. The Filter Change check is now nested so pre_d
-- is only read on filter_change_plans.
--
-- Same rules as 20261118000000 otherwise. Running this changes no existing
-- rows: it redefines one function.

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

  -- Filter Change: Pre D always wins.
  if TG_TABLE_NAME = 'filter_change_plans' then
    if NEW.pre_d is not null then
      NEW.acc_d := NEW.pre_d;
      return NEW;
    end if;
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
