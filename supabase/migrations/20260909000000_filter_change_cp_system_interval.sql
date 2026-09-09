-- Filter-change recurring schedule becomes CP-System-driven where a real,
-- populated link exists, instead of the flat 3-month cadence every order
-- gets today (see sync_filter_change_schedule's own original comment:
-- "Deliberately does NOT gate on c_t at all... a filter needs replacing on
-- this cadence regardless of how the customer is billed" -- confirmed
-- during investigation that C/T was never actually this generator's
-- interval; that hardcoded 3 was it). This is additive, not a rewrite:
-- every order without a cp_system_id link, or linked to a system with no
-- components defined yet (the catalog is currently only ~6 of 30+ real
-- system codes), keeps generating on exactly the same flat 3-month cycle
-- as today -- nothing regresses for anyone until an admin deliberately
-- links their order to a real, populated CP System.
--
-- =========================================================================
-- 1. cp_system_min_interval_months() -- the shared interval resolver all
--    three call sites below use, so they can never drift into disagreeing
--    about which interval a given cp_system_id actually means. Mirrors
--    getCpSystemMinIntervalMonths() in src/lib/utils.ts exactly (shortest
--    component interval wins -- the fastest-wearing part paces the whole
--    system), just re-expressed in SQL since this needs to run inside a
--    trigger, not a route. components is stored as plain camelCase JSON
--    (confirmed against CpSystemComponent's own shape -- {name,
--    intervalMonths, quantity} -- api/cp-systems.ts never transforms it),
--    so intervalMonths is read as-is, no snake_case conversion needed.
--    NULL in, NULL out (no link, or a link to a system with an empty/
--    missing components array) -- every call site below is responsible for
--    coalescing that back to 3, not this function.
-- =========================================================================
create or replace function public.cp_system_min_interval_months(p_cp_system_id uuid)
returns integer
language sql
stable
as $$
  select min((c->>'intervalMonths')::integer)
    from public.cp_systems s, jsonb_array_elements(s.components) as c
    where s.id = p_cp_system_id;
$$;

-- =========================================================================
-- 2. sync_filter_change_schedule() -- only change is v_interval_months
--    replacing the hardcoded 3. Everything else (anchor resolution, 2-year
--    horizon cap, the 500-iteration safety exit, the upsert/delete-extras
--    shape) is byte-for-byte what it already was.
-- =========================================================================
create or replace function public.sync_filter_change_schedule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_customer_full_name text;
  v_customer_company_name text;
  v_customer_address text;
  v_customer_contact_number text;
  v_anchor_date date;
  v_cap_date date;
  v_interval_months integer;
  v_index integer := 0;
  v_date date;
  v_final_count integer := 0;
begin
  if NEW.customer_id is not null then
    select full_name, company_name, address, contact_number
      into v_customer_full_name, v_customer_company_name, v_customer_address, v_customer_contact_number
      from public.customers where id = NEW.customer_id;
  end if;

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null then
    delete from public.filter_change_plans where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

  v_anchor_date := public.filter_change_schedule_anchor_date(NEW.id, NEW.cp_start);
  v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);
  -- A real, populated CP System link paces this order on its own actual
  -- shortest component interval; everything else keeps the existing flat
  -- 3-month cadence exactly as before this migration.
  v_interval_months := coalesce(public.cp_system_min_interval_months(NEW.cp_system_id), 3);

  -- Day 0 itself (v_index = 0) is Plan D/installation — no filter change
  -- happens then, so generation starts at v_index = 1 (one interval out
  -- from the anchor), not 0.
  v_index := 1;
  loop
    v_date := (v_anchor_date + make_interval(months => v_interval_months * v_index))::date;
    exit when v_date > v_cap_date;
    exit when v_index > 500;

    insert into public.filter_change_plans (
      order_number, member_account, filter_type, plan_date, status,
      contact_number, address, product_no, s_c,
      customer_id, sale_list_entry_id, occurrence_index, source
    )
    values (
      NEW.order_number,
      coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
      '',
      v_date,
      'Pending',
      coalesce(v_customer_contact_number, ''),
      coalesce(v_customer_address, ''),
      coalesce(NEW.product_no, ''),
      coalesce(NEW.s_c, ''),
      NEW.customer_id,
      NEW.id,
      v_index,
      'recurring_schedule'
    )
    on conflict (sale_list_entry_id, occurrence_index) where sale_list_entry_id is not null
    do update set
      plan_date = excluded.plan_date,
      order_number = excluded.order_number,
      member_account = excluded.member_account,
      contact_number = excluded.contact_number,
      address = excluded.address,
      product_no = excluded.product_no,
      s_c = excluded.s_c
    where public.filter_change_plans.status = 'Pending';

    v_final_count := v_index + 1;
    v_index := v_index + 1;
  end loop;

  delete from public.filter_change_plans
    where sale_list_entry_id = NEW.id
      and occurrence_index >= v_final_count
      and status = 'Pending';

  return NEW;
end;
$$;

-- Trigger definition itself is unchanged (still fires on cp_start, cp_end,
-- status, order_number, customer_id) -- deliberately NOT adding
-- cp_system_id to this list. Linking/unlinking a CP System without also
-- touching one of these columns won't retroactively repace an
-- already-generated series; the daily extend cron and any subsequent
-- admin edit will still pick up the new interval going forward. Revisit
-- if immediate re-pacing on link/unlink turns out to matter in practice.

-- =========================================================================
-- 3. reanchor_filter_change_schedule() -- fires on filter_change_plans,
--    which doesn't carry cp_system_id itself; resolved via the same
--    sale_list_entry_id link every other lookup here already uses. Only
--    real addition versus the original: v_interval_months looked up once,
--    used in place of the hardcoded 3 in the recalculation loop.
-- =========================================================================
create or replace function public.reanchor_filter_change_schedule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  v_cp_system_id uuid;
  v_interval_months integer;
begin
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  if NEW.source <> 'recurring_schedule' or NEW.sale_list_entry_id is null or NEW.occurrence_index is null then
    return NEW;
  end if;
  if OLD.plan_date is not distinct from NEW.plan_date then
    return NEW;
  end if;

  select cp_system_id into v_cp_system_id
    from public.sale_list_entries where id = NEW.sale_list_entry_id;
  v_interval_months := coalesce(public.cp_system_min_interval_months(v_cp_system_id), 3);

  for r in
    select id, occurrence_index from public.filter_change_plans
    where sale_list_entry_id = NEW.sale_list_entry_id
      and occurrence_index > NEW.occurrence_index
      and status = 'Pending'
    order by occurrence_index
  loop
    update public.filter_change_plans
      set plan_date = (NEW.plan_date + make_interval(months => v_interval_months * (r.occurrence_index - NEW.occurrence_index)))::date
      where id = r.id;
  end loop;

  return NEW;
end;
$$;

-- =========================================================================
-- 4. extend_filter_change_schedule_window() -- same v_interval_months
--    resolution, sourced from cp_system_id now included in the entry loop's
--    own select list (it already reads several other sale_list_entries
--    columns per row, so this is one more field on the same query, not a
--    new one).
-- =========================================================================
create or replace function public.extend_filter_change_schedule_window()
returns table (out_sale_list_entry_id uuid, out_occurrences_added integer)
language plpgsql
security definer set search_path = public
as $$
declare
  entry record;
  v_customer_full_name text;
  v_customer_company_name text;
  v_customer_address text;
  v_customer_contact_number text;
  v_anchor_date date;
  v_cap_date date;
  v_interval_months integer;
  v_start_index integer;
  v_index integer;
  v_date date;
  v_added integer;
begin
  for entry in
    select id, order_number, customer_id, cp_start, product_no, s_c, cp_system_id
      from public.sale_list_entries
      where status = 'ACTIVE' and cp_start is not null
  loop
    v_customer_full_name := null;
    v_customer_company_name := null;
    v_customer_address := null;
    v_customer_contact_number := null;
    if entry.customer_id is not null then
      select full_name, company_name, address, contact_number
        into v_customer_full_name, v_customer_company_name, v_customer_address, v_customer_contact_number
        from public.customers where id = entry.customer_id;
    end if;

    v_anchor_date := public.filter_change_schedule_anchor_date(entry.id, entry.cp_start);
    v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);
    v_interval_months := coalesce(public.cp_system_min_interval_months(entry.cp_system_id), 3);

    select coalesce(max(occurrence_index), 0) + 1 into v_start_index
      from public.filter_change_plans where sale_list_entry_id = entry.id;

    v_added := 0;
    v_index := v_start_index;
    loop
      v_date := (v_anchor_date + make_interval(months => v_interval_months * v_index))::date;
      exit when v_date > v_cap_date;
      exit when v_index > 500;

      insert into public.filter_change_plans (
        order_number, member_account, filter_type, plan_date, status,
        contact_number, address, product_no, s_c,
        customer_id, sale_list_entry_id, occurrence_index, source
      )
      values (
        entry.order_number,
        coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
        '',
        v_date,
        'Pending',
        coalesce(v_customer_contact_number, ''),
        coalesce(v_customer_address, ''),
        coalesce(entry.product_no, ''),
        coalesce(entry.s_c, ''),
        entry.customer_id,
        entry.id,
        v_index,
        'recurring_schedule'
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
