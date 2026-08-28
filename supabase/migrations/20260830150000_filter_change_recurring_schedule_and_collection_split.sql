-- Two related changes to the recurring Collection/Filter Change schedule,
-- per the exact timeline: Day 0 (Plan D) = install, no filter change, no
-- collection; Month 3/6/9/12 = a filter change every time regardless of
-- C/T; Collection amount is the customer's total C/F prorated across
-- however many occurrences their own C/T produces per year (Quarterly:
-- 4/year, so C/F ÷ 4 each; Yearly: 1/year, so the full C/F once) rather
-- than the full C/F amount every single occurrence as before.
--
-- Confirmed with the admin before implementing:
--   * The cycle repeats indefinitely year over year (month 12 becomes the
--     next year's own "month 0"), matching the existing rolling-window
--     design rather than stopping after one year.
--   * Existing live Pending collections get corrected to the new
--     prorated-amount model (not just newly-created entries) — the backfill
--     at the bottom of this file does that.
--   * Filter Change becomes its own new recurring schedule (mirroring how
--     Collection already works), entirely separate from the existing
--     monitoring-interval-based filter-change-schedule cron (that one
--     dispatches a technician visit off customers.installed_date +
--     company_settings.monitoring_intervals — untouched here, different
--     anchor, different purpose). This one is Plan-D/Sale-List-entry
--     anchored and always exactly 3 months apart regardless of C/T.

-- =========================================================================
-- 1. filter_change_plans gets the same recurring-schedule plumbing
--    collections already has: a link to which sale list entry + occurrence
--    a row belongs to, a uniqueness guarantee against duplicates, and a
--    widened source tag.
-- =========================================================================
alter table public.filter_change_plans
  add column if not exists sale_list_entry_id uuid references public.sale_list_entries(id) on delete cascade,
  add column if not exists occurrence_index integer;

create unique index if not exists filter_change_plans_sale_list_entry_occurrence_key
  on public.filter_change_plans (sale_list_entry_id, occurrence_index)
  where sale_list_entry_id is not null;

alter table public.filter_change_plans drop constraint if exists filter_change_plans_source_check;
alter table public.filter_change_plans
  add constraint filter_change_plans_source_check check (source in ('manual', 'ct_completion', 'recurring_schedule'));

-- =========================================================================
-- 2. Anchor resolver for the Filter Change schedule — same pattern as
--    collection_schedule_anchor_date(): occurrence 0's own current plan_date
--    if a series already exists (which may be an admin's direct edit, not
--    cp_start at all), otherwise the given default (cp_start), for a
--    first-ever generation. Without this, an admin-edited Plan D on the
--    Filter Change page would get silently reverted the next time this
--    entry's sale_list_entries row is saved or the extend cron runs.
-- =========================================================================
create or replace function public.filter_change_schedule_anchor_date(p_sale_list_entry_id uuid, p_default date)
returns date
language sql
stable
as $$
  select coalesce(
    (select plan_date from public.filter_change_plans
      where sale_list_entry_id = p_sale_list_entry_id and occurrence_index = 0
      limit 1),
    p_default
  );
$$;

-- =========================================================================
-- 3. sync_filter_change_schedule() — fires on a deliberate change to the
--    sale list entry (full resync of every still-Pending occurrence,
--    deletes now-invalid extras, never touches a Completed/Cancelled row).
--    Deliberately does NOT gate on c_t at all (unlike collections) — a
--    filter needs replacing on this cadence regardless of how the customer
--    is billed, or even if C/T is blank.
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
  -- Same rolling 2-year horizon as Collections (collection_schedule_horizon()
  -- is a generic "how far ahead do we generate" concept despite its name —
  -- shared rather than duplicated).
  v_cap_date := greatest(public.collection_schedule_horizon(), v_anchor_date);

  -- Day 0 itself (v_index = 0) is Plan D/installation — no filter change
  -- happens then, so generation starts at v_index = 1 (month 3), not 0.
  v_index := 1;
  loop
    v_date := (v_anchor_date + make_interval(months => 3 * v_index))::date;
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

drop trigger if exists trg_sync_filter_change_schedule on public.sale_list_entries;
create trigger trg_sync_filter_change_schedule
  after insert or update of cp_start, cp_end, status, order_number, customer_id
  on public.sale_list_entries
  for each row execute function public.sync_filter_change_schedule();

-- =========================================================================
-- 4. reanchor_filter_change_schedule() — admin edits one occurrence's Plan
--    Date on the Filter Change page (the existing edit dialog's planDate
--    field, already admin-only at the RLS layer) and every later
--    still-Pending occurrence of that same entry recalculates from it,
--    exactly 3 months apart. Same pg_trigger_depth() guard as Collections'
--    own reanchor trigger, for the same reason (its own cascading UPDATEs
--    would otherwise re-fire this trigger and cascade again uselessly).
-- =========================================================================
create or replace function public.reanchor_filter_change_schedule()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
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

  for r in
    select id, occurrence_index from public.filter_change_plans
    where sale_list_entry_id = NEW.sale_list_entry_id
      and occurrence_index > NEW.occurrence_index
      and status = 'Pending'
    order by occurrence_index
  loop
    update public.filter_change_plans
      set plan_date = (NEW.plan_date + make_interval(months => 3 * (r.occurrence_index - NEW.occurrence_index)))::date
      where id = r.id;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_reanchor_filter_change_schedule on public.filter_change_plans;
create trigger trg_reanchor_filter_change_schedule
  after update of plan_date on public.filter_change_plans
  for each row execute function public.reanchor_filter_change_schedule();

-- =========================================================================
-- 5. extend_filter_change_schedule_window() — the purely-additive
--    counterpart called by the daily cron (see below), mirroring
--    extend_collection_schedule_window(): only ever INSERTs occurrences
--    beyond whatever already exists as today's date advances the rolling
--    window forward, never touches an existing row.
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
  v_start_index integer;
  v_index integer;
  v_date date;
  v_added integer;
begin
  for entry in
    select id, order_number, customer_id, cp_start, product_no, s_c
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

    select coalesce(max(occurrence_index), 0) + 1 into v_start_index
      from public.filter_change_plans where sale_list_entry_id = entry.id;

    v_added := 0;
    v_index := v_start_index;
    loop
      v_date := (v_anchor_date + make_interval(months => 3 * v_index))::date;
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

grant execute on function public.extend_filter_change_schedule_window() to service_role;

-- =========================================================================
-- 6. Collection amount now prorated by the fraction of the year each
--    occurrence covers (interval_months / 12) instead of the full C/F every
--    time. Quarterly (3-month interval): C/F ÷ 4. Yearly/default
--    (12-month interval): C/F × 1 — unchanged, still the full amount, since
--    there's only one occurrence per year. Monthly/Half Year follow the
--    same formula (÷12, ÷2 respectively) as the natural extension of the
--    same rule, consistent with how ct_interval_months() already treats
--    them everywhere else. Nothing else about sync_collection_schedule()/
--    extend_collection_schedule_window() changes — anchor resolution,
--    horizon capping, upsert-vs-Pending-only guards are all exactly as
--    they were.
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
  -- Prorated: the customer's total C/F split across however many
  -- occurrences their own C/T produces in a year (12 / interval_months).
  v_amount := round(public.parse_currency_amount(NEW.c_f) * v_interval_months / 12.0, 2);
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

-- =========================================================================
-- 7. Backfill — force every currently-ACTIVE sale list entry's triggers to
--    refire once, so:
--     a) every existing Quarterly customer's still-Pending collections get
--        recomputed to the new prorated amount (Collected rows are never
--        touched — sync_collection_schedule()'s own upsert already guards
--        on `where status = 'Pending'`), and
--     b) every eligible entry gets its Filter Change recurring schedule
--        generated for the first time ever (trg_sync_filter_change_schedule
--        is brand new — nothing has fired it until now).
--    Exploits the same `UPDATE OF <col>` semantics already used elsewhere
--    in this app's migrations: a self-assignment still fires an
--    `after ... update of cp_start` trigger even though the value doesn't
--    actually change. cp_start is a watched column on both triggers, so one
--    statement covers both.
-- =========================================================================
update public.sale_list_entries
  set cp_start = cp_start
  where status = 'ACTIVE' and cp_start is not null;
