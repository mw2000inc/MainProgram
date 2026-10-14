-- Collection amounts: the full C/F on every visit, and missing member details
-- filled from the Sale List.
--
-- 1. The amount rule (decided with the admin on 2026-10-14): a collection
--    visit always collects the order's full C/F — Quarterly ₱4,200 is ₱4,200
--    every quarter, Yearly ₱8,500 is ₱8,500 — never C/F × months / 12, which
--    split a Quarterly C/F into four. sync_collection_schedule() and
--    extend_collection_schedule_window() are redefined from their latest
--    versions (20261004000000) with only the amount line changed.
-- 2. Backfill: still-Pending, not-collected recurring collection rows take
--    their Sale List entry's full C/F (only where the C/F is set). Checked
--    live: 249 rows on 22 Quarterly orders (C/T "Quarterly" or "Q"), all
--    Pending; no Collected row changes, so no payment history is rewritten.
--    Yearly rows already equal the C/F; Monthly collections are manual.
-- 3. Backfill: a collection row missing its Account Name, member link or
--    C/T gets them from its order — its own Sale List entry, else the Sale
--    List entry with the same Order No. — and that entry's member (Account
--    Name = company name, else contact person). Only blanks are filled.
--    Checked live: 10 rows miss an Account Name or C/T, e.g. 001-0572
--    (whose Sale List entry has no C/T itself, so its C/T stays blank).

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

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' or public.ct_interval_months(NEW.c_t) = 1 then
    delete from public.collections where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

  v_interval_months := public.ct_interval_months(NEW.c_t);
  v_amount := round(public.parse_currency_amount(NEW.c_f), 2); -- the full C/F every visit, never divided
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
      where status = 'ACTIVE' and cp_start is not null and coalesce(c_t, '') <> '' and public.ct_interval_months(c_t) <> 1
  loop
    v_customer_full_name := null;
    v_customer_company_name := null;
    if entry.customer_id is not null then
      select full_name, company_name into v_customer_full_name, v_customer_company_name
        from public.customers where id = entry.customer_id;
    end if;

    v_interval_months := public.ct_interval_months(entry.c_t);
    v_amount := round(public.parse_currency_amount(entry.c_f), 2); -- the full C/F every visit, never divided
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

-- =========================================================================
-- 2. Amounts: the full C/F on still-pending recurring rows
-- =========================================================================
update public.collections c
  set amount = round(public.parse_currency_amount(s.c_f), 2)
  from public.sale_list_entries s
  where c.sale_list_entry_id = s.id
    and c.source = 'recurring_schedule'
    and c.status = 'Pending'
    and not coalesce(c.collected, false)
    and public.parse_currency_amount(s.c_f) > 0
    and c.amount is distinct from round(public.parse_currency_amount(s.c_f), 2);

-- =========================================================================
-- 3. Missing Account Name / member / C/T from the order
-- =========================================================================
with entry as (
  select c.id as collection_id, s.c_t, s.customer_id
  from public.collections c
  join lateral (
    select se.c_t, se.customer_id
    from public.sale_list_entries se
    where se.id = c.sale_list_entry_id
       or (c.sale_list_entry_id is null and trim(se.order_number) = trim(c.order_no) and trim(c.order_no) <> '')
    order by (se.id = c.sale_list_entry_id) desc, se.created_at desc
    limit 1
  ) s on true
  where coalesce(trim(c.account_name), '') = '' or c.customer_id is null or coalesce(trim(c.c_t), '') = ''
)
update public.collections c
  set account_name = case
        when coalesce(trim(c.account_name), '') = '' then coalesce(nullif(trim(cu.company_name), ''), nullif(trim(cu.full_name), ''), c.account_name)
        else c.account_name end,
      customer_id = coalesce(c.customer_id, e.customer_id),
      c_t = case when coalesce(trim(c.c_t), '') = '' and coalesce(trim(e.c_t), '') <> '' then e.c_t else c.c_t end
  from entry e
  left join public.customers cu on cu.id = e.customer_id
  where c.id = e.collection_id;
