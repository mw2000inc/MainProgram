-- Monthly C/T customers should never get an auto-generated collection —
-- confirmed with the admin: Quarterly/Half Year/Yearly already produce the
-- right dates purely from ct_interval_months(c_t) math (3/6/12 months,
-- which lines up with every/every-2nd/every-4th filter change respectively,
-- since filter changes are always exactly 3 months apart), but Monthly
-- collections stay fully manual, same as they've always been entered.
-- ct_interval_months(c_t) = 1 is unique to Monthly (Quarterly/Half Year/
-- Yearly/default map to 3/6/12), so that's the guard added to both the
-- per-row sync trigger and the rolling-window extend function — same
-- shape as the existing "blank C/T" and "not ACTIVE" guards each already
-- had, just one more condition alongside them.

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

  v_interval_months := public.ct_interval_months(NEW.c_t);

  if NEW.status <> 'ACTIVE' or NEW.cp_start is null or coalesce(NEW.c_t, '') = '' or v_interval_months = 1 then
    delete from public.collections where sale_list_entry_id = NEW.id and status = 'Pending';
    return NEW;
  end if;

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
        and public.ct_interval_months(c_t) <> 1
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

-- Backfill: clear out any already-generated still-Pending Monthly
-- collections (Collected rows are never touched) and let the trigger
-- refire to confirm nothing regenerates for them, same self-assignment
-- trick used by the migration that first introduced this schedule.
update public.sale_list_entries
  set cp_start = cp_start
  where status = 'ACTIVE' and cp_start is not null and public.ct_interval_months(c_t) = 1;
