-- Switching an already-linked order to a different CP System now updates
-- the Filter on its Pending visits too, not just their dates.
--
-- Before: sync_filter_change_schedule() only ever filled a Filter that was
-- blank, so after a switch (e.g. UF45 -> RO73) every Pending visit kept
-- UF45's codes while being re-paced to RO73's interval (confirmed live with
-- a throwaway order: 1 of 5 visits ended up with RO73's codes).
--
-- Now, when cp_system_id changes, each Pending recurring visit whose Filter
-- is exactly what the OLD system would have generated for it is cleared
-- first, so the existing fill-if-blank step below writes the NEW system's
-- codes. A Filter that doesn't match the old system's codes was typed or
-- edited by hand, so it's left as it is. "Exactly" means the same codes in
-- the same order, ignoring surrounding spaces.
--
-- Old codes are worked out the way they were generated: occurrence_index
-- times the old system's own shortest interval (3 months if it had none).
-- Everything else in this function is unchanged from
-- 20261008000000_cp_system_filter_auto_fill.sql.

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
  v_old_interval_months integer;
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

  -- CP System switched: clear the Filters the old system generated, so the
  -- loop below refills them from the new one. Hand-edited Filters stay.
  if TG_OP = 'UPDATE' and OLD.cp_system_id is distinct from NEW.cp_system_id then
    v_old_interval_months := coalesce(public.cp_system_min_interval_months(OLD.cp_system_id), 3);
    update public.filter_change_plans
      set filter_type = ''
      where sale_list_entry_id = NEW.id
        and status = 'Pending'
        and source = 'recurring_schedule'
        and occurrence_index is not null
        and filter_type <> ''
        and trim(filter_type) = public.cp_system_due_filters(OLD.cp_system_id, v_old_interval_months * occurrence_index);
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
