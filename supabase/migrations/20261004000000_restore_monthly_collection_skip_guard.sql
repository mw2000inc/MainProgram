-- 20260912000000_first_occurrence_requires_approval.sql redefined
-- sync_collection_schedule() and extend_collection_schedule_window() to add
-- dispatch_status to their INSERTs, claiming ("Every one of the four
-- functions below is unchanged except for adding dispatch_status...") that
-- interval math was otherwise byte-for-byte identical to the prior version.
-- That claim was wrong for these two: it silently dropped the Monthly-C/T
-- exclusion guard that 20260904000000_collection_schedule_skip_monthly.sql
-- had deliberately added ("confirmed with the admin: ... Monthly collections
-- stay fully manual"). As a result, live data currently has 9 ACTIVE
-- Monthly-C/T orders with 246 wrongly auto-generated Pending
-- recurring_schedule collection rows.
--
-- This restores the exact guard from 20260904000000 (ct_interval_months = 1
-- excluded from both the sync trigger and the extend cron), otherwise
-- leaving both functions unchanged from their 20260912000000 definitions,
-- and cleans up the rows that were wrongly generated in the meantime.
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

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' or public.ct_interval_months(NEW.c_t) = 1 then
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

-- One-time cleanup of the rows wrongly auto-generated for Monthly-C/T orders
-- while the guard was missing (live-verified: 246 rows across 9 ACTIVE
-- orders, all status = 'Pending', none 'Collected' -- no real payment
-- history is touched by this).
delete from public.collections c
using public.sale_list_entries s
where c.sale_list_entry_id = s.id
  and c.source = 'recurring_schedule'
  and c.status = 'Pending'
  and public.ct_interval_months(s.c_t) = 1;
