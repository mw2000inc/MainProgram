-- Recurring Collection schedule, generated automatically from a sale list
-- entry's C/T (interval) and CP Start/CP End — so an admin never has to
-- manually create each quarterly/monthly/yearly collection occurrence.
--
-- Data flow:
--   sale_list_entries (c_t, cp_start, cp_end, c_f, status) changes
--     --sync_collection_schedule trigger--> one collections row per
--       occurrence date (cp_start, cp_start+interval, ... up to cp_end),
--       source='recurring_schedule', linked via sale_list_entry_id +
--       occurrence_index (the stable identity — collection_date can change,
--       occurrence_index never does once assigned)
--   Admin edits one occurrence's date (via the Collection Plan UI)
--     --reanchor_collection_schedule trigger--> every LATER still-Pending
--       occurrence for that same entry is recomputed relative to the edited
--       date, using the same C/T interval
--
-- A 'Pending' occurrence is always kept in sync with the current schedule
-- (from either path above); a 'Collected' one is never touched by either
-- trigger, regardless of its index — this is the historical-accuracy
-- guarantee. This is additive to the existing collections table and the
-- 'ct_completion' source from the ct_filter_change_collection_inventory_link
-- migration — the two sources are independent (different link columns,
-- different unique constraints) and don't interact.

-- =========================================================================
-- 1. Link collections to the sale list entry + occurrence it belongs to
-- =========================================================================
alter table public.collections
  add column if not exists sale_list_entry_id uuid references public.sale_list_entries(id) on delete cascade,
  add column if not exists occurrence_index integer;

-- The actual "don't create duplicate occurrences" guarantee — enforced at
-- the database level, not just by the generating function's own care.
create unique index if not exists collections_sale_list_entry_occurrence_key
  on public.collections (sale_list_entry_id, occurrence_index)
  where sale_list_entry_id is not null;

alter table public.collections drop constraint if exists collections_source_check;
alter table public.collections
  add constraint collections_source_check check (source in ('manual', 'ct_completion', 'recurring_schedule'));

-- =========================================================================
-- 2. C/T-to-months and currency-text-to-number helpers. ct_interval_months
--    is a SQL mirror of src/lib/ct-interval.ts's ctIntervalMonths() — a
--    Postgres trigger can't call TS code, so this is the second half of
--    "centralized so the same rules are used everywhere": one mapping,
--    defined once per language, kept in sync by hand. Update both together
--    if this mapping ever changes.
-- =========================================================================
create or replace function public.ct_interval_months(p_ct text)
returns integer
language sql
immutable
as $$
  select case lower(trim(coalesce(p_ct, '')))
    when 'monthly' then 1
    when 'm' then 1
    when 'quarterly' then 3
    when 'q' then 3
    when 'half year' then 6
    when 'halfyear' then 6
    when 'h' then 6
    when 'semi-annual' then 6
    when 'semiannual' then 6
    else 12
  end;
$$;

-- c_f (the Sale List's "C/F" amount) is free text with real, inconsistent
-- formatting in production data ("₱3,000", "9600", "14400") — strips
-- everything but digits and a decimal point, defaulting to 0 for anything
-- that leaves nothing usable. plpgsql (not plain sql) specifically so a
-- pathological value that still isn't valid numeric after stripping (e.g.
-- something with two decimal points) can't throw and abort the whole
-- sale_list_entries save it's called from — falls back to 0 instead.
create or replace function public.parse_currency_amount(p_text text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_stripped text;
begin
  v_stripped := nullif(regexp_replace(coalesce(p_text, ''), '[^0-9.]', '', 'g'), '');
  if v_stripped is null then
    return 0;
  end if;
  return v_stripped::numeric;
exception when others then
  return 0;
end;
$$;

-- =========================================================================
-- 3. Generates/syncs the occurrence series whenever a sale list entry's
--    schedule-relevant fields change.
-- =========================================================================
create or replace function public.sync_collection_schedule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_customer_full_name text;
  v_customer_company_name text;
  v_interval_months integer;
  v_amount numeric;
  v_cap_date date;
  v_index integer := 0;
  v_date date;
  v_final_count integer := 0;
begin
  if NEW.customer_id is not null then
    select full_name, company_name into v_customer_full_name, v_customer_company_name
      from public.customers where id = NEW.customer_id;
  end if;

  -- Not an active, dated, C/T-bearing entry — nothing to schedule. Clean up
  -- any still-Pending occurrences left over from a prior state (status
  -- flipped away from ACTIVE, or C/T/CP Start cleared) so a stale schedule
  -- doesn't linger — a Collected row is never touched here or below.
  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' then
    delete from public.collections where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

  v_interval_months := public.ct_interval_months(NEW.c_t);
  v_amount := public.parse_currency_amount(NEW.c_f);
  -- No CP End to bound an open-ended series against — generate just the
  -- single occurrence at CP Start rather than an indefinite schedule.
  v_cap_date := coalesce(NEW.cp_end, NEW.cp_start);

  loop
    v_date := (NEW.cp_start + make_interval(months => v_interval_months * v_index))::date;
    exit when v_date > v_cap_date;
    -- Hard circuit breaker against a pathological interval/date-range
    -- combination — 200 occurrences is far beyond any real contract length
    -- even at Monthly (16+ years), so this is purely a safety net.
    exit when v_index > 200;

    insert into public.collections (
      order_no, account_name, collection_date, amount, status,
      customer_id, sale_list_entry_id, occurrence_index, source, c_t
    )
    values (
      NEW.order_number,
      coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
      v_date,
      v_amount,
      'Pending',
      NEW.customer_id,
      NEW.id,
      v_index,
      'recurring_schedule',
      NEW.c_t
    )
    on conflict (sale_list_entry_id, occurrence_index) where sale_list_entry_id is not null
    do update set
      collection_date = excluded.collection_date,
      amount = excluded.amount,
      order_no = excluded.order_no,
      account_name = excluded.account_name,
      c_t = excluded.c_t
    where public.collections.status = 'Pending';

    v_final_count := v_index + 1;
    v_index := v_index + 1;
  end loop;

  -- The schedule may now be shorter than before (C/T lengthened, or CP End
  -- moved earlier) — drop any leftover still-Pending occurrences beyond the
  -- newly computed count. A Collected one is never removed, at any index.
  delete from public.collections
    where sale_list_entry_id = NEW.id
      and occurrence_index >= v_final_count
      and status = 'Pending';

  return NEW;
end;
$$;

drop trigger if exists trg_sync_collection_schedule on public.sale_list_entries;
create trigger trg_sync_collection_schedule
  after insert or update of c_t, cp_start, cp_end, c_f, status, order_number, customer_id
  on public.sale_list_entries
  for each row execute function public.sync_collection_schedule();

-- =========================================================================
-- 4. Editing one occurrence's date re-anchors every later, still-Pending
--    occurrence of the same entry to chain from it at the same C/T
--    interval — "the subsequent dates should be recalculated" per the
--    stated requirement. A Collected occurrence is never touched, and never
--    used as a re-anchor source itself (the trigger only fires on a
--    Pending row's date changing in the first place, since Collected rows
--    are a separate, protected concern from here on).
-- =========================================================================
create or replace function public.reanchor_collection_schedule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_ct text;
  v_interval_months integer;
  r record;
begin
  -- Only the top-level edit (the actual admin action) should cascade — the
  -- chained updates this function issues below would otherwise re-fire this
  -- same trigger and cascade again on every step, uselessly (each
  -- subsequent recomputation would land on the exact same dates the outer
  -- call already computed).
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  if NEW.source <> 'recurring_schedule' or NEW.sale_list_entry_id is null or NEW.occurrence_index is null then
    return NEW;
  end if;
  if OLD.collection_date is not distinct from NEW.collection_date then
    return NEW;
  end if;

  select c_t into v_ct from public.sale_list_entries where id = NEW.sale_list_entry_id;
  v_interval_months := public.ct_interval_months(v_ct);

  for r in
    select id, occurrence_index from public.collections
    where sale_list_entry_id = NEW.sale_list_entry_id
      and occurrence_index > NEW.occurrence_index
      and status = 'Pending'
    order by occurrence_index
  loop
    update public.collections
      set collection_date =
        (NEW.collection_date + make_interval(months => v_interval_months * (r.occurrence_index - NEW.occurrence_index)))::date
      where id = r.id;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_reanchor_collection_schedule on public.collections;
create trigger trg_reanchor_collection_schedule
  after update of collection_date on public.collections
  for each row execute function public.reanchor_collection_schedule();

-- =========================================================================
-- 5. Tightens handle_schedule_job_filter_item() (from the
--    ct_filter_change_collection_inventory_link migration): it looked up
--    the job's customer/order/technician/date but never actually checked
--    the job's own status, so recording filter items for a job that hadn't
--    been marked completed would still generate Filter Change/Collection
--    records and a pending stock movement. The app's own "Mark Job as Done"
--    flow always completes the job before recording items, so this was
--    never reachable through the UI — this closes the gap at the database
--    layer too, per "a customer/job should only be reflected as an active
--    Collection result from the C/T workflow when the C/T has actually been
--    completed".
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
    where schedule_job_id = new.schedule_job_id and product_id = new.product_id
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

-- =========================================================================
-- 6. Backfill: generate the schedule for every currently-ACTIVE sale list
--    entry that already has a C/T and CP Start, so existing records (like
--    order 001-0001) get their recurring schedule immediately rather than
--    waiting for their next unrelated edit. The trigger only fires on
--    UPDATE OF specific columns (so an edit to, say, `note` doesn't
--    needlessly re-sync the schedule) — `set c_t = c_t` still satisfies
--    that "OF c_t" clause even though the value doesn't actually change,
--    which is what actually fires it here.
-- =========================================================================
update public.sale_list_entries
  set c_t = c_t
  where status = 'ACTIVE' and cp_start is not null and coalesce(c_t, '') <> '';
