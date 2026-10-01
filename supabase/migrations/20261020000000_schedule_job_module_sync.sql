-- =========================================================================
-- Schedule job -> module record sync, and Realtime for the Daily Report.
--
-- Until now the link only ran one way: confirming a Filter Change / install /
-- repair / collection record created its schedule job
-- (find_or_create_schedule_job). A job added any other way — the Schedule
-- form, an Auto-suggest errand, the daily filter-change automation, or a
-- direct insert — had no record behind it, so it never showed in the Daily
-- Report's Filter Change / Installation / Repair / Collection widgets.
--
-- 1. ensure_schedule_job_module_record(job_id) — for a live ('pending')
--    filter_change / installation / repair / collection job with no linked
--    record yet:
--      a. LINK the nearest open, unlinked record for the same order (or
--         customer) within 60 days of the job date — so a job for a visit
--         that's already planned never duplicates it — moving its planned
--         date (pre_d / pre_installed_date) to the job's date and copying
--         the technicians; otherwise
--      b. CREATE the record from the job and its customer.
--    Jobs still awaiting admin approval ('pending_approval') are synced when
--    approved, not before. Monitoring/other jobs have no module.
--
-- 2. trg_schedule_job_module_sync — a DEFERRED constraint trigger, so it
--    runs at commit: find_or_create_schedule_job inserts the job and links
--    its record in the same transaction, and by commit that link exists, so
--    the dispatch-confirm flow is left alone instead of getting a duplicate.
--
-- 3. sync_schedule_job_changes_to_module — moving a job's date or changing
--    its technicians updates the linked (not yet Completed/Cancelled)
--    record, so the Daily Report widget shows it on the new date.
--
-- 4. Adds the Daily Report's tables to the supabase_realtime publication so
--    open browsers refresh their widgets when any of them change.
--
-- Existing jobs are NOT backfilled (27 pending Filter Change jobs from the
-- automation exist at the time of writing); run
--   select public.ensure_schedule_job_module_record(id) from public.schedule_jobs where status = 'pending';
-- by hand if that's wanted.
-- =========================================================================

create or replace function public.ensure_schedule_job_module_record(p_job_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  j public.schedule_jobs%rowtype;
  c public.customers%rowtype;
  v_order text;
  v_account text;
  v_address text;
  v_contact text;
  v_tech text;
  v_tech2 text;
  v_id uuid;
begin
  select * into j from public.schedule_jobs where id = p_job_id;
  if not found or j.status <> 'pending' then
    return null;
  end if;
  if j.job_type not in ('filter_change', 'installation', 'repair', 'collection') then
    return null;
  end if;

  if j.customer_id is not null then
    select * into c from public.customers where id = j.customer_id;
  end if;
  v_order := coalesce(nullif(trim(j.order_no), ''), nullif(trim(c.order_number), ''));
  -- Nothing to identify the record by.
  if v_order is null and j.customer_id is null then
    return null;
  end if;
  v_account := coalesce(nullif(trim(c.company_name), ''), nullif(trim(c.full_name), ''), '');
  v_address := coalesce(nullif(trim(j.secondary_address), ''), c.address, '');
  v_contact := coalesce(c.contact_number, '');
  v_tech := coalesce(j.technician, '');
  v_tech2 := case when v_tech = '' then '' else coalesce(j.technician_2, '') end;

  if j.job_type = 'filter_change' then
    if exists (select 1 from public.filter_change_plans where schedule_job_id = j.id) then
      return null;
    end if;
    select id into v_id from public.filter_change_plans
      where schedule_job_id is null
        and status = 'Pending'
        and ((v_order is not null and order_number = v_order) or (j.customer_id is not null and customer_id = j.customer_id))
        and abs(coalesce(pre_d, plan_date) - j.scheduled_date) <= 60
      order by abs(coalesce(pre_d, plan_date) - j.scheduled_date), created_at
      limit 1;
    if v_id is not null then
      update public.filter_change_plans set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end,
        filter_type = case when coalesce(j.filter_codes, '') <> '' then j.filter_codes else filter_type end
      where id = v_id;
      return 'filter_change_plans:linked';
    end if;
    insert into public.filter_change_plans
      (order_number, member_account, filter_type, plan_date, pre_d, contact_number, address,
       serviceman, serviceman_2, note, customer_id, schedule_job_id)
    values
      (coalesce(v_order, ''), coalesce(c.member_account_number, ''), coalesce(j.filter_codes, ''),
       j.scheduled_date, j.scheduled_date, v_contact, v_address, v_tech, v_tech2, j.notes, j.customer_id, j.id);
    return 'filter_change_plans:created';

  elsif j.job_type = 'installation' then
    if exists (select 1 from public.install_plans where schedule_job_id = j.id) then
      return null;
    end if;
    if v_order is not null then
      select id into v_id from public.install_plans
        where schedule_job_id is null
          and status = 'Pending'
          and installed_date is null
          and order_no = v_order
          and abs(coalesce(pre_installed_date, input_date) - j.scheduled_date) <= 60
        order by abs(coalesce(pre_installed_date, input_date) - j.scheduled_date), created_at
        limit 1;
    end if;
    if v_id is not null then
      update public.install_plans set
        schedule_job_id = j.id,
        pre_installed_date = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end
      where id = v_id;
      return 'install_plans:linked';
    end if;
    insert into public.install_plans
      (name, order_no, input_date, pre_installed_date, address, contact_number,
       serviceman, serviceman_2, note, member_account_number, schedule_job_id)
    values
      (v_account, coalesce(v_order, ''), j.scheduled_date, j.scheduled_date, v_address, v_contact,
       v_tech, v_tech2, j.notes, coalesce(c.member_account_number, ''), j.id);
    return 'install_plans:created';

  elsif j.job_type = 'repair' then
    if exists (select 1 from public.repair_plans where schedule_job_id = j.id) then
      return null;
    end if;
    if v_order is not null then
      select id into v_id from public.repair_plans
        where schedule_job_id is null
          and status = 'Pending'
          and order_no = v_order
          and abs(coalesce(pre_d, issued_date) - j.scheduled_date) <= 60
        order by abs(coalesce(pre_d, issued_date) - j.scheduled_date), created_at
        limit 1;
    end if;
    if v_id is not null then
      update public.repair_plans set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        th = case when v_tech <> '' then v_tech else th end,
        th_2 = case when v_tech <> '' then v_tech2 else th_2 end
      where id = v_id;
      return 'repair_plans:linked';
    end if;
    insert into public.repair_plans
      (account_name, order_no, issued_date, pre_d, address, contact_number, th, th_2, note, schedule_job_id)
    values
      (v_account, coalesce(v_order, ''), j.scheduled_date, j.scheduled_date, v_address, v_contact,
       v_tech, v_tech2, j.notes, j.id);
    return 'repair_plans:created';

  else -- collection
    if exists (select 1 from public.collections where schedule_job_id = j.id) then
      return null;
    end if;
    select id into v_id from public.collections
      where schedule_job_id is null
        and status = 'Pending'
        and not collected
        and ((v_order is not null and order_no = v_order) or (j.customer_id is not null and customer_id = j.customer_id))
        and abs(coalesce(pre_d, collection_date) - j.scheduled_date) <= 60
      order by abs(coalesce(pre_d, collection_date) - j.scheduled_date), created_at
      limit 1;
    if v_id is not null then
      update public.collections set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end
      where id = v_id;
      return 'collections:linked';
    end if;
    insert into public.collections
      (order_no, account_name, collection_date, pre_d, serviceman, serviceman_2, note, customer_id, schedule_job_id)
    values
      (coalesce(v_order, ''), v_account, j.scheduled_date, j.scheduled_date, v_tech, v_tech2, j.notes, j.customer_id, j.id);
    return 'collections:created';
  end if;
end;
$$;

revoke all on function public.ensure_schedule_job_module_record(uuid) from public, anon, authenticated;

create or replace function public.trg_ensure_schedule_job_module_record()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.ensure_schedule_job_module_record(NEW.id);
  return null;
end;
$$;

drop trigger if exists trg_schedule_job_module_sync on public.schedule_jobs;
create constraint trigger trg_schedule_job_module_sync
  after insert or update of status on public.schedule_jobs
  deferrable initially deferred
  for each row execute function public.trg_ensure_schedule_job_module_record();

create or replace function public.sync_schedule_job_changes_to_module()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_date boolean := OLD.scheduled_date is distinct from NEW.scheduled_date;
  v_tech boolean := OLD.technician is distinct from NEW.technician
                    or OLD.technician_2 is distinct from NEW.technician_2;
  t1 text := coalesce(NEW.technician, '');
  t2 text := case when coalesce(NEW.technician, '') = '' then '' else coalesce(NEW.technician_2, '') end;
begin
  if not (v_date or v_tech) then
    return null;
  end if;

  if NEW.job_type = 'filter_change' then
    update public.filter_change_plans set
      pre_d = case when v_date then NEW.scheduled_date else pre_d end,
      serviceman = case when v_tech then t1 else serviceman end,
      serviceman_2 = case when v_tech then t2 else serviceman_2 end
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  elsif NEW.job_type = 'installation' then
    update public.install_plans set
      pre_installed_date = case when v_date then NEW.scheduled_date else pre_installed_date end,
      serviceman = case when v_tech then t1 else serviceman end,
      serviceman_2 = case when v_tech then t2 else serviceman_2 end
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  elsif NEW.job_type = 'repair' then
    update public.repair_plans set
      pre_d = case when v_date then NEW.scheduled_date else pre_d end,
      th = case when v_tech then t1 else th end,
      th_2 = case when v_tech then t2 else th_2 end
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  elsif NEW.job_type = 'collection' then
    update public.collections set
      pre_d = case when v_date then NEW.scheduled_date else pre_d end,
      serviceman = case when v_tech then t1 else serviceman end,
      serviceman_2 = case when v_tech then t2 else serviceman_2 end
    where schedule_job_id = NEW.id and status not in ('Collected', 'Completed', 'Cancelled');
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_schedule_job_changes_to_module on public.schedule_jobs;
create trigger trg_sync_schedule_job_changes_to_module
  after update of scheduled_date, technician, technician_2 on public.schedule_jobs
  for each row execute function public.sync_schedule_job_changes_to_module();

-- Realtime: postgres_changes respects RLS, so each browser only hears about
-- rows it can already read.
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['schedule_jobs', 'filter_change_plans', 'install_plans', 'repair_plans', 'collections', 'stock_movements'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
