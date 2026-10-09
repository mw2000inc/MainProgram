-- Completing a schedule job completes its linked visit record, and completing
-- a visit record completes its still-open job — in BOTH directions, for every
-- way a job or record is completed (the Schedule panel's single "Mark done"
-- tick by an admin or the assigned technician, the batch "Mark as Completed",
-- the Filter Change / Install / Repair pages, All Collection, and anything
-- added later).
--
-- Why: only the batch route (/api/schedule-jobs/complete, see
-- src/lib/scheduling/complete-jobs.ts) completed the linked record. The
-- single tick set only schedule_jobs.status, so the Daily Report's Filter
-- Change / Collection / Install / Repair panels kept showing the visit as
-- Pending; and completing a record on its own page left its job pending.
--
-- 1. Job -> record (sync_job_completion_to_records): when a job BECOMES
--    'completed', its linked records are completed with the batch's own
--    rules —
--      Filter Change / Install / Repair -> status 'Completed', an empty Acc D
--        / Installed Date set to today (Manila);
--      Collection, only for a COLLECTION job -> status 'Collected',
--        collected = true, Collected by / Collected at / Acc D filled only if
--        empty (a payment linked to a filter change or repair visit isn't
--        proof the money was received just because the visit was done).
--    Cancelled records are never touched; already-completed ones are left
--    as they are. The inventory-queue triggers then react exactly as they do
--    to any completion (a visit's filters, an install's unit).
--    Un-ticking (completed -> pending) changes nothing on the record.
--
-- 2. Record -> job (sync_record_completion_to_job): when a linked record
--    BECOMES completed (Completed; for a collection, Collected or
--    collected = true), its job is completed if it is still 'pending' and of
--    the matching type (filter_change / installation / repair / collection).
--    A draft ('pending_approval') job is left for its own approval.
--
--    No loop: each side only writes rows not already completed, so one round
--    trip settles (job completes -> record completes -> its job is already
--    completed, nothing to do; and the reverse).
--
-- 3. Inventory is never queued twice:
--    - Batch route: it completes the jobs (step 1 completes their records and
--      queues once), then re-saves those records as Completed. The Filter
--      Change queue only acts when a record first becomes completed, and the
--      install queue updates its single movement in place, so the re-save
--      queues nothing. Repairs and collections queue nothing on completion.
--    - Single "Mark done" with filter items: the job is completed first
--      (step 1 queues the linked record's own filters), then each item is
--      added. handle_schedule_job_filter_item() (redefined below from its
--      latest version, 20260830080000_collection_recurring_schedule.sql —
--      only its duplicate check changes) now also counts movements already
--      queued for the job's linked Filter Change record, so a product queued
--      there isn't queued again for the job.
--
-- Running this changes no existing rows: it creates two new functions and
-- their triggers and redefines handle_schedule_job_filter_item(), which only
-- runs on a new filter item. It doesn't redefine anything from
-- 20261015000000 (sync_filter_change_schedule) or 20261026000000
-- (confirm_records_of_approved_job / confirm_record_linked_to_approved_job).
-- Existing mismatches (a completed record with a pending job, or the
-- reverse) are NOT backfilled.

-- =========================================================================
-- 1. Job -> record
-- =========================================================================
create or replace function public.sync_job_completion_to_records()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if NEW.status <> 'completed' or OLD.status = 'completed' then
    return null;
  end if;

  update public.filter_change_plans
    set status = 'Completed', acc_d = coalesce(acc_d, v_today)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  update public.install_plans
    set status = 'Completed', installed_date = coalesce(installed_date, v_today)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');
  update public.repair_plans
    set status = 'Completed', acc_d = coalesce(acc_d, v_today)
    where schedule_job_id = NEW.id and status not in ('Completed', 'Cancelled');

  if NEW.job_type::text = 'collection' then
    update public.collections
      set status = 'Collected',
        collected = true,
        collected_by = coalesce(collected_by, auth.uid()),
        collected_at = coalesce(collected_at, now()),
        acc_d = coalesce(acc_d, v_today)
      where schedule_job_id = NEW.id
        and status <> 'Cancelled'
        and not (status = 'Collected' and collected);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_job_completion_to_records on public.schedule_jobs;
create trigger trg_sync_job_completion_to_records
  after update of status on public.schedule_jobs
  for each row execute function public.sync_job_completion_to_records();

-- =========================================================================
-- 2. Record -> job
-- =========================================================================
create or replace function public.sync_record_completion_to_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_done boolean;
  v_was_done boolean;
  v_job_type text;
begin
  if NEW.schedule_job_id is null then
    return null;
  end if;

  if TG_TABLE_NAME = 'collections' then
    v_done := NEW.status = 'Collected' or coalesce(NEW.collected, false);
    v_was_done := OLD.status = 'Collected' or coalesce(OLD.collected, false);
    v_job_type := 'collection';
  else
    v_done := NEW.status = 'Completed';
    v_was_done := OLD.status = 'Completed';
    v_job_type := case TG_TABLE_NAME
      when 'filter_change_plans' then 'filter_change'
      when 'install_plans' then 'installation'
      when 'repair_plans' then 'repair'
    end;
  end if;

  if not v_done or v_was_done then
    return null;
  end if;

  update public.schedule_jobs
    set status = 'completed'
    where id = NEW.schedule_job_id
      and status = 'pending'
      -- job_type is the schedule_job_type enum; compared as text.
      and job_type::text = v_job_type;
  return null;
end;
$$;

drop trigger if exists trg_sync_record_completion_to_job on public.filter_change_plans;
create trigger trg_sync_record_completion_to_job
  after update of status on public.filter_change_plans
  for each row execute function public.sync_record_completion_to_job();

drop trigger if exists trg_sync_record_completion_to_job on public.install_plans;
create trigger trg_sync_record_completion_to_job
  after update of status on public.install_plans
  for each row execute function public.sync_record_completion_to_job();

drop trigger if exists trg_sync_record_completion_to_job on public.repair_plans;
create trigger trg_sync_record_completion_to_job
  after update of status on public.repair_plans
  for each row execute function public.sync_record_completion_to_job();

drop trigger if exists trg_sync_record_completion_to_job on public.collections;
create trigger trg_sync_record_completion_to_job
  after update of status, collected on public.collections
  for each row execute function public.sync_record_completion_to_job();

-- =========================================================================
-- 3. handle_schedule_job_filter_item() — latest version
--    (20260830080000_collection_recurring_schedule.sql), unchanged except
--    the duplicate check before queuing a movement: it also counts a
--    movement already queued for the job's linked Filter Change record.
-- =========================================================================
create or replace function public.handle_schedule_job_filter_item()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_customer_id uuid;
  v_job_order_no text;
  v_job_technician text;
  v_job_scheduled_date date;
  v_job_status text;
  v_customer_full_name text;
  v_customer_company_name text;
  v_customer_member_account_number text;
  v_customer_address text;
  v_customer_contact_number text;
  v_filter_summary text;
  v_existing_movement uuid;
begin
  select customer_id, order_no, technician, scheduled_date, status
    into v_job_customer_id, v_job_order_no, v_job_technician, v_job_scheduled_date, v_job_status
    from public.schedule_jobs where id = new.schedule_job_id;

  if v_job_status is distinct from 'completed' then
    return new;
  end if;

  if v_job_customer_id is not null then
    select full_name, company_name, member_account_number, address, contact_number
      into v_customer_full_name, v_customer_company_name, v_customer_member_account_number,
        v_customer_address, v_customer_contact_number
      from public.customers where id = v_job_customer_id;
  end if;

  select string_agg(p.name || ' x' || i.quantity, ', ' order by p.name)
    into v_filter_summary
    from public.schedule_job_filter_items i
    join public.products p on p.id = i.product_id
    where i.schedule_job_id = new.schedule_job_id;

  insert into public.filter_change_plans (
    order_number, member_account, filter_type, plan_date, status,
    contact_number, address, serviceman, customer_id, schedule_job_id, source
  )
  values (
    coalesce(v_job_order_no, ''),
    coalesce(v_customer_member_account_number, ''),
    coalesce(v_filter_summary, ''),
    coalesce(v_job_scheduled_date, current_date),
    'Pending',
    coalesce(v_customer_contact_number, ''),
    coalesce(v_customer_address, ''),
    coalesce(v_job_technician, ''),
    v_job_customer_id,
    new.schedule_job_id,
    'ct_completion'
  )
  on conflict (schedule_job_id) where schedule_job_id is not null
  do update set filter_type = excluded.filter_type;

  insert into public.collections (
    order_no, account_name, collection_date, status,
    customer_id, schedule_job_id, source, filter_change_required
  )
  values (
    coalesce(v_job_order_no, ''),
    coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
    coalesce(v_job_scheduled_date, current_date),
    'Pending',
    v_job_customer_id,
    new.schedule_job_id,
    'ct_completion',
    true
  )
  on conflict (schedule_job_id) where schedule_job_id is not null
  do update set filter_change_required = true;

  select id into v_existing_movement
    from public.stock_movements
    where product_id = new.product_id
      and (schedule_job_id = new.schedule_job_id
        or filter_change_plan_id in (select id from public.filter_change_plans where schedule_job_id = new.schedule_job_id))
    limit 1;

  if v_existing_movement is null then
    insert into public.stock_movements (
      date, product_id, quantity_added, quantity_removed,
      reason, user_id, reference_number, schedule_job_id, status
    )
    values (
      coalesce(v_job_scheduled_date, current_date),
      new.product_id,
      0,
      new.quantity,
      'Filter Change',
      auth.uid(),
      coalesce(v_job_order_no, new.schedule_job_id::text),
      new.schedule_job_id,
      'pending'
    );
  end if;

  return new;
end;
$$;
