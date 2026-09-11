-- Requires a real Draft -> Admin Approve -> Customer Confirm cycle once per
-- order, instead of every CP-cycle-generated occurrence skipping approval
-- entirely (the status quo since 20260830160000_dispatch_confirmation_workflow.sql,
-- which deliberately left recurring-schedule/C-T-completion generation
-- alone: "requiring a fresh customer confirmation for every one of a
-- customer's already-agreed quarterly/yearly occurrences would be an
-- unreasonable admin burden"). That reasoning still holds for every
-- occurrence AFTER the first -- this migration only changes the very first
-- one for a given order, so the customer confirms the schedule exists once,
-- not every quarter forever.
--
-- "First occurrence" reuses the existing occurrence_index scheme, no new
-- column/table/UI needed: filter_change_plans skips index 0 (that's the
-- install itself, not a filter change -- see sync_filter_change_schedule's
-- own comment), so its first real occurrence is index 1; collections has no
-- such skip, so its first is index 0. A Draft row created this way is
-- byte-for-byte the same shape a manual "Add" form's Draft row already is
-- (see filter-change-form-dialog.tsx/collections-form-dialog.tsx setting
-- dispatchStatus: "Draft" today) -- it flows into the existing
-- DispatchApprovalQueue/PendingApprovalsPanel, the existing
-- approve_dispatch_item() RPC, and the existing /confirm/[token] portal page
-- with zero changes to any of that already-generic machinery.
--
-- Every one of the four functions below is unchanged except for adding
-- dispatch_status to its own INSERT's column/value lists -- anchor
-- resolution, interval math, horizon capping, and every ON CONFLICT clause
-- are byte-for-byte identical to their prior versions. Critically, none of
-- the ON CONFLICT ... DO UPDATE/DO NOTHING clauses are touched to also set
-- dispatch_status -- that's what makes this safe to re-run: a later re-fire
-- of the same trigger (e.g. an admin edits cp_start) hits the DO UPDATE
-- branch for an occurrence that already exists, which never touches
-- dispatch_status, so an already-Confirmed first occurrence can never be
-- silently reset back to Draft. It also means all 1,137 existing rows are
-- left exactly as they are -- this only ever fires on a genuinely fresh
-- insert for occurrence 0/1, i.e. a new or newly-reactivated order.
--
-- Deliberately NOT touching the ct_completion source (a technician
-- completing a job in the field auto-creating the next plan from that job's
-- own data) -- that's a different, more immediate mechanism than the
-- recurring CP-cycle schedule this migration is about.

-- =========================================================================
-- 1. sync_filter_change_schedule() -- first real occurrence is v_index = 1.
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
      customer_id, sale_list_entry_id, occurrence_index, source, dispatch_status
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
      'recurring_schedule',
      case when v_index = 1 then 'Draft' else 'Confirmed' end
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

-- =========================================================================
-- 2. extend_filter_change_schedule_window() -- same rule. In the ordinary
--    case v_start_index is already >= 2 (occurrence 1 was created by
--    sync_filter_change_schedule() above when the order first went ACTIVE),
--    so this branch is nearly always 'Confirmed' -- the v_index = 1 case
--    only matters for the edge case of an order whose first occurrence
--    somehow doesn't exist yet when this daily cron runs.
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
        customer_id, sale_list_entry_id, occurrence_index, source, dispatch_status
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
        'recurring_schedule',
        case when v_index = 1 then 'Draft' else 'Confirmed' end
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
-- 3. sync_collection_schedule() -- first real occurrence is v_index = 0
--    (collections has no "day 0 is the install, skip it" concept — billing
--    starts immediately at cp_start).
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
  v_amount := round(public.parse_currency_amount(NEW.c_f) * v_interval_months / 12.0, 2);
  v_anchor_date := public.collection_schedule_anchor_date(NEW.id, NEW.cp_start);
  v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);

  loop
    v_date := (v_anchor_date + make_interval(months => v_interval_months * v_index))::date;
    exit when v_date > v_cap_date;
    exit when v_index > 500;

    insert into public.collections (
      order_no, account_name, collection_date, amount, status,
      customer_id, sale_list_entry_id, occurrence_index, source, c_t, dispatch_status
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
      NEW.c_t,
      case when v_index = 0 then 'Draft' else 'Confirmed' end
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
-- 4. extend_collection_schedule_window() -- same rule, same edge-case
--    reasoning as extend_filter_change_schedule_window() above.
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
    v_amount := round(public.parse_currency_amount(entry.c_f) * v_interval_months / 12.0, 2);
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
        customer_id, sale_list_entry_id, occurrence_index, source, c_t, dispatch_status
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
        entry.c_t,
        case when v_index = 0 then 'Draft' else 'Confirmed' end
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
