-- Makes the actual Plan D (occurrence 0's collection_date) the real anchor
-- for a recurring series, instead of always stepping from
-- sale_list_entries.cp_start directly. Fixes a real gap found via review:
-- both sync_collection_schedule() and extend_collection_schedule_window()
-- computed every occurrence's date straight from cp_start, so once an
-- admin edited occurrence 0's Plan D (via reanchor_collection_schedule),
-- ANY later re-fire of either function — the sale list entry being
-- re-saved for an unrelated reason, or just the next day's rolling-window
-- cron run — would silently recompute occurrence 0 back to the original
-- cp_start, discarding the admin's edit. cp_start now only ever seeds
-- occurrence 0 the very first time a series is generated for an entry;
-- once it exists, its own current date is what every later occurrence (and
-- any newly-extended one) steps from.

-- =========================================================================
-- 1. Shared anchor resolver — occurrence 0's current date if a series
--    already exists for this entry, otherwise the given default
--    (cp_start), for a first-ever generation.
-- =========================================================================
create or replace function public.collection_schedule_anchor_date(p_sale_list_entry_id uuid, p_default date)
returns date
language sql
stable
as $$
  select coalesce(
    (select collection_date from public.collections
      where sale_list_entry_id = p_sale_list_entry_id and occurrence_index = 0
      limit 1),
    p_default
  );
$$;

-- =========================================================================
-- 2. sync_collection_schedule() — steps from the resolved anchor, not
--    cp_start directly. Otherwise unchanged from the rolling-window
--    version: still a full resync of every other still-Pending occurrence,
--    still deletes now-invalid extras, still never touches a Collected row.
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
  v_anchor_date date;
  v_cap_date date;
  v_index integer := 0;
  v_date date;
  v_final_count integer := 0;
begin
  if NEW.customer_id is not null then
    select full_name, company_name into v_customer_full_name, v_customer_company_name
      from public.customers where id = NEW.customer_id;
  end if;

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' then
    delete from public.collections where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

  v_interval_months := public.ct_interval_months(NEW.c_t);
  v_amount := public.parse_currency_amount(NEW.c_f);
  -- The real anchor: occurrence 0's own current Plan D if one already
  -- exists (which may be an admin's direct edit, not cp_start at all) —
  -- cp_start only matters the very first time, before occurrence 0 exists.
  v_anchor_date := public.collection_schedule_anchor_date(NEW.id, NEW.cp_start);
  v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);

  loop
    v_date := (v_anchor_date + make_interval(months => v_interval_months * v_index))::date;
    exit when v_date > v_cap_date;
    exit when v_index > 500;

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

  delete from public.collections
    where sale_list_entry_id = NEW.id
      and occurrence_index >= v_final_count
      and status = 'Pending';

  return NEW;
end;
$$;

-- =========================================================================
-- 3. extend_collection_schedule_window() — same anchor fix. Without this,
--    a newly-extended occurrence past the end of an admin-edited series
--    would land on a date computed from the ORIGINAL cp_start, breaking
--    the interval chain the admin's edit had established (e.g. a series
--    re-anchored to the 10th of the month would suddenly get a new
--    occurrence back on the 25th).
-- =========================================================================
create or replace function public.extend_collection_schedule_window()
returns table (out_sale_list_entry_id uuid, out_occurrences_added integer)
language plpgsql
security definer set search_path = public
as $$
declare
  entry record;
  v_customer_full_name text;
  v_customer_company_name text;
  v_interval_months integer;
  v_amount numeric;
  v_anchor_date date;
  v_cap_date date;
  v_start_index integer;
  v_index integer;
  v_date date;
  v_added integer;
begin
  for entry in
    select id, order_number, customer_id, c_t, cp_start, c_f
      from public.sale_list_entries
      where status = 'ACTIVE' and cp_start is not null and coalesce(c_t, '') <> ''
  loop
    v_customer_full_name := null;
    v_customer_company_name := null;
    if entry.customer_id is not null then
      select full_name, company_name into v_customer_full_name, v_customer_company_name
        from public.customers where id = entry.customer_id;
    end if;

    v_interval_months := public.ct_interval_months(entry.c_t);
    v_amount := public.parse_currency_amount(entry.c_f);
    v_anchor_date := public.collection_schedule_anchor_date(entry.id, entry.cp_start);
    v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);

    select coalesce(max(occurrence_index), -1) + 1 into v_start_index
      from public.collections where sale_list_entry_id = entry.id;

    v_added := 0;
    v_index := v_start_index;
    loop
      v_date := (v_anchor_date + make_interval(months => v_interval_months * v_index))::date;
      exit when v_date > v_cap_date;
      exit when v_index > 500;

      insert into public.collections (
        order_no, account_name, collection_date, amount, status,
        customer_id, sale_list_entry_id, occurrence_index, source, c_t
      )
      values (
        entry.order_number,
        coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
        v_date,
        v_amount,
        'Pending',
        entry.customer_id,
        entry.id,
        v_index,
        'recurring_schedule',
        entry.c_t
      )
      on conflict (sale_list_entry_id, occurrence_index) where sale_list_entry_id is not null
      do nothing;

      v_added := v_added + 1;
      v_index := v_index + 1;
    end loop;

    if v_added > 0 then
      out_sale_list_entry_id := entry.id;
      out_occurrences_added := v_added;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.extend_collection_schedule_window() to service_role;
