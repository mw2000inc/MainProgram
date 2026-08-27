-- Changes the recurring Collection schedule from "generate once, capped at
-- CP End" to a rolling window that keeps extending over time — CP End no
-- longer stops generation (a contract is treated as ongoing/renewing, per
-- explicit confirmation), but the schedule still isn't unbounded: it always
-- covers exactly "today + 2 years" ahead, re-extended by a new daily cron
-- as time passes, the same pattern already used by filter-change-schedule.
--
-- This required splitting what was one trigger into two functions with a
-- real behavioral difference, not just a refactor:
--
--   sync_collection_schedule()  (trigger, fires on a DELIBERATE change to
--     c_t/cp_start/cp_end/status/etc.) — full resync: recomputes every
--     still-Pending occurrence's date fresh from CP Start, and deletes any
--     that no longer fit (e.g. C/T lengthened). This is what an admin
--     editing the Sale List entry itself should do — a real schedule
--     change wins over whatever was there before.
--
--   extend_collection_schedule_window()  (called by the new
--     collection-schedule-extend cron, NOT a trigger) — purely additive:
--     only INSERTs occurrences beyond whatever already exists, and never
--     touches an existing row. This is what "the window grew because a day
--     passed" should do — it must never undo an admin's per-occurrence date
--     edit (see reanchor_collection_schedule) just because the cron happened
--     to run again. Before this split, both cases went through the same
--     always-overwrite logic, which was fine when a resync only ever
--     happened on a deliberate, rare edit — it would have silently reverted
--     admin edits every time the new periodic cron ran otherwise.

-- =========================================================================
-- 1. The rolling horizon itself — one definition, used by both paths below.
-- =========================================================================
create or replace function public.collection_schedule_horizon()
returns date
language sql
stable
as $$
  select (current_date + interval '2 years')::date;
$$;

-- =========================================================================
-- 2. sync_collection_schedule() — CP End no longer caps generation; the cap
--    is now the rolling horizon (or CP Start itself, if that's already
--    later than the horizon, so a far-future CP Start still gets its own
--    first occurrence rather than an empty result). Otherwise unchanged
--    from the collection_recurring_schedule migration: still a full
--    resync, still deletes now-invalid extras, still never touches a
--    Collected row.
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

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' then
    delete from public.collections where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

  v_interval_months := public.ct_interval_months(NEW.c_t);
  v_amount := public.parse_currency_amount(NEW.c_f);
  -- CP End is no longer a hard stop — a contract is treated as ongoing
  -- unless its status is actually flipped away from ACTIVE. The rolling
  -- horizon governs how far ahead this generates instead.
  v_cap_date := greatest(public.collection_schedule_horizon(), NEW.cp_start);

  loop
    v_date := (NEW.cp_start + make_interval(months => v_interval_months * v_index))::date;
    exit when v_date > v_cap_date;
    -- Hard circuit breaker — 500 occurrences is far beyond any real
    -- customer relationship even at Monthly (40+ years), purely a safety
    -- net now that generation is no longer bounded by a fixed CP End.
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
-- 3. extend_collection_schedule_window() — purely additive. For every
--    ACTIVE, C/T + CP-Start-bearing sale list entry, adds any occurrences
--    between whatever already exists and the (now-later, since time has
--    passed since this entry's last resync) rolling horizon. Never updates
--    or deletes an existing row, admin-edited or not — that's the entire
--    point of this being a separate function from sync_collection_schedule.
-- =========================================================================
create or replace function public.extend_collection_schedule_window()
returns table (sale_list_entry_id uuid, occurrences_added integer)
language plpgsql
security definer set search_path = public
as $$
declare
  entry record;
  v_customer_full_name text;
  v_customer_company_name text;
  v_interval_months integer;
  v_amount numeric;
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
    v_cap_date := greatest(public.collection_schedule_horizon(), entry.cp_start);

    select coalesce(max(occurrence_index), -1) + 1 into v_start_index
      from public.collections where sale_list_entry_id = entry.id;

    v_added := 0;
    v_index := v_start_index;
    loop
      v_date := (entry.cp_start + make_interval(months => v_interval_months * v_index))::date;
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
      sale_list_entry_id := entry.id;
      occurrences_added := v_added;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.extend_collection_schedule_window() to service_role;
