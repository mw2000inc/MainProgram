-- Auto-fills Filter Change's Filter field on every recurring_schedule row
-- generated for an order with a real CP System link — matching AppSheet,
-- where the admin never assigned filters by hand.
--
-- The rule (confirmed against every one of the 25 currently-linked orders'
-- 241 generated rows, live, before writing this): a component is due at a
-- visit when the whole months elapsed since the order's own CP Start date is
-- an exact multiple of that component's own interval. sync_filter_change_
-- schedule() and extend_filter_change_schedule_window() already space visits
-- at anchor + (shortest_interval * occurrence_index) (see the
-- filter_change_cp_system_interval migration), so elapsed months at any
-- generated visit is exactly shortest_interval * occurrence_index — the same
-- number those functions already compute to place the date. No new date
-- math is needed.
--
-- A component's identity in cp_systems.components is a loose "[code] /
-- [description]" text convention (or a bare code — see that same
-- migration's own comment on the format), never a product_id. Unlike
-- getCpSystemFilterSkus() (the client-side helper used for the Add dialog's
-- own on-blur suggestion), this keeps an unresolved bare code as-is (401,
-- 1152, 601, 603, 9002, ...) rather than dropping it — AppSheet itself
-- writes "401" for AW-S1 even though that part was never added to this
-- app's own product catalog, and there is nothing else to show instead.
--
-- =========================================================================
-- 1. cp_system_due_filters() -- the comma-joined "code, code, ..." Filter
--    text for one system at one point in its cycle. A component appearing
--    at two different intervals (e.g. PF42's "1152" at both 3 and 6 months)
--    is grouped down to one entry, sorted by whichever of its own intervals
--    is due soonest — ties broken alphabetically by code, since a stored
--    array position isn't meaningful here the way it is in the client-side
--    formatCpSystemComponents (which instead keeps original array order on
--    a tie; a cosmetic difference only, never a different set of parts).
-- =========================================================================
create or replace function public.cp_system_due_filters(p_cp_system_id uuid, p_elapsed_months integer)
returns text
language sql
stable
as $$
  select coalesce(string_agg(code, ', ' order by min_interval, code), '')
  from (
    select split_part(c->>'name', ' / ', 1) as code, min((c->>'intervalMonths')::integer) as min_interval
    from jsonb_array_elements(coalesce((select components from public.cp_systems where id = p_cp_system_id), '[]'::jsonb)) as c
    where p_elapsed_months % (c->>'intervalMonths')::integer = 0
    group by split_part(c->>'name', ' / ', 1)
  ) due
$$;

-- =========================================================================
-- 2. sync_filter_change_schedule() -- only changes: filter_type is now
--    cp_system_due_filters(...) instead of the hardcoded '', and the
--    upsert's own DO UPDATE now backfills filter_type too, but only while
--    it's still '' -- an admin's own typed value (or a value this same
--    function already filled in) is never touched. Everything else is
--    byte-for-byte what it already was.
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
      public.cp_system_due_filters(NEW.cp_system_id, v_interval_months * v_index),
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
      s_c = excluded.s_c,
      filter_type = case
        when public.filter_change_plans.filter_type = '' then excluded.filter_type
        else public.filter_change_plans.filter_type
      end
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

-- =========================================================================
-- 3. extend_filter_change_schedule_window() -- same filter_type change as
--    above. Its own ON CONFLICT is DO NOTHING (v_start_index always starts
--    past every existing row, so that branch is a dead-row safety net, not
--    a real update path) -- nothing to add-only guard here.
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
        public.cp_system_due_filters(entry.cp_system_id, v_interval_months * v_index),
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

-- =========================================================================
-- 4. One-time backfill -- the 241 rows (confirmed live before writing this)
--    that are already generated, blank, and belong to a linked order. Uses
--    the exact same elapsed-months math the generator itself uses. Add-only
--    via the filter_type = '' guard: never touches a row an admin already
--    typed into, and running this migration twice is a no-op the second time.
-- =========================================================================
update public.filter_change_plans p
set filter_type = public.cp_system_due_filters(
  e.cp_system_id,
  coalesce(public.cp_system_min_interval_months(e.cp_system_id), 3) * p.occurrence_index
)
from public.sale_list_entries e
where p.sale_list_entry_id = e.id
  and p.filter_type = ''
  and p.occurrence_index is not null
  and e.cp_system_id is not null;
