-- A completed install gets a completed Installation job, so it shows in the
-- Daily Report's Schedule panel on the day it was installed.
--
-- Why: completing an install already completes its linked job
-- (20261027000000), but an install with NO job never got one — 20 of 23
-- installs on Oct 10, 2026 had none, so they never reached the Schedule.
--
-- 1. An Installed Date completes the install: when an install is inserted
--    or its Installed Date is set/changed while it is still Pending, it
--    becomes Completed (BEFORE trigger). Only on that date change, so an
--    admin who sets the status back to Pending isn't overridden.
-- 2. A completed install with no job gets one (AFTER trigger): a
--    'completed' installation job dated the Installed Date (today, Manila,
--    if blank), technician(s) = the install's Serviceman (and Serviceman 2),
--    their logins matched by name, the customer found through the Sale List
--    order, address and "Name — Model" as notes, source 'automation'. The
--    install is then linked to it.
--
-- Side effects checked: no job trigger reacts to a job INSERTED as
-- completed (the 20261027 sync only acts on a status change; the job ->
-- record trigger only on approved 'pending' jobs); linking the job skips the
-- 20261028 date sync for done records; the install stock queue reacts only to
-- model/date/order changes, never to status. No notification is sent.
-- Un-completing an install later leaves its job completed (as before).
--
-- Changes no existing row by itself — back-filling the older installs is a
-- separate, optional migration (20261101000100).

create or replace function public.complete_install_on_installed_date()
returns trigger
language plpgsql
as $$
begin
  if NEW.installed_date is not null
     and NEW.status = 'Pending'
     and (TG_OP = 'INSERT' or OLD.installed_date is distinct from NEW.installed_date) then
    NEW.status := 'Completed';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_complete_install_on_installed_date on public.install_plans;
create trigger trg_complete_install_on_installed_date
  before insert or update of installed_date on public.install_plans
  for each row execute function public.complete_install_on_installed_date();

create or replace function public.create_job_for_completed_install()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job uuid;
  v_customer uuid;
  v_tech text := coalesce(trim(NEW.serviceman), '');
  v_tech2 text := nullif(trim(coalesce(NEW.serviceman_2, '')), '');
  v_order text := nullif(trim(coalesce(NEW.order_no, '')), '');
begin
  if NEW.status <> 'Completed' or NEW.schedule_job_id is not null then
    return null;
  end if;

  if v_order is not null then
    select e.customer_id into v_customer
    from public.sale_list_entries e
    where trim(e.order_number) = v_order and e.customer_id is not null
    limit 1;
  end if;

  insert into public.schedule_jobs (
    job_type, status, source, scheduled_date, order_no, customer_id,
    technician, technician_2, technician_user_id, technician_2_user_id,
    secondary_address, notes
  ) values (
    'installation', 'completed', 'automation',
    coalesce(NEW.installed_date, (now() at time zone 'Asia/Manila')::date),
    v_order, v_customer,
    v_tech, v_tech2,
    (select p.id from public.profiles p where v_tech <> '' and lower(trim(p.name)) = lower(v_tech) limit 1),
    (select p.id from public.profiles p where v_tech2 is not null and lower(trim(p.name)) = lower(v_tech2) limit 1),
    nullif(trim(coalesce(NEW.address, '')), ''),
    nullif(concat_ws(' — ', nullif(trim(coalesce(NEW.name, '')), ''), nullif(trim(coalesce(NEW.model, '')), '')), '')
  )
  returning id into v_job;

  update public.install_plans
    set schedule_job_id = v_job
    where id = NEW.id and schedule_job_id is null;
  return null;
end;
$$;

drop trigger if exists trg_create_job_for_completed_install on public.install_plans;
create trigger trg_create_job_for_completed_install
  after insert or update of status, installed_date on public.install_plans
  for each row execute function public.create_job_for_completed_install();
