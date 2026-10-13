-- Records made or linked when a hand-made job is approved get their member's
-- details.
--
-- ensure_schedule_job_module_record (20261020000000) runs when a job is
-- approved and links it to its Filter Change / Installation / Repair /
-- Collection record, or creates one. A job made with Schedule Job usually has
-- only an Order No., and the function found the member only through the job's
-- customer_id — so the record it created had no Account Name, Address or
-- Contact Number (three Filter Changes made this way on 2026-10-13). And its
-- new Filter Change got the member's account NUMBER in "Member Account",
-- where every other Filter Change holds the account name.
--
-- Changes (everything else is as before):
--   1. no customer_id → the member is found by Order No. through the Sale
--      List (sale_list_entries.customer_id), like the app's Add forms;
--   2. a created Filter Change gets the Account Name (company name, else
--      contact person) in Member Account, and the member's customer_id;
--   3. linking an existing record fills its Account Name, Address and
--      Contact Number only where they are blank — never overwrites;
--   4. Filter Change / Collection lookups also match on the member found in 1.
-- A job whose Order No. has no Sale List entry still gets a record with only
-- that number, as before — there is nothing to fill it from.
--
-- Backfill at the end: pending records linked to a job that are still blank
-- get the same details, by the same lookup.

create or replace function public.ensure_schedule_job_module_record(p_job_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  j public.schedule_jobs%rowtype;
  c public.customers%rowtype;
  v_order text;
  v_account text;
  v_address text;
  v_contact text;
  v_tech text;
  v_tech2 text;
  v_id uuid;
begin
  select * into j from public.schedule_jobs where id = p_job_id;
  if not found or j.status <> 'pending' then
    return null;
  end if;
  if j.job_type not in ('filter_change', 'installation', 'repair', 'collection') then
    return null;
  end if;

  if j.customer_id is not null then
    select * into c from public.customers where id = j.customer_id;
  end if;
  -- A hand-made job usually has only its Order No.: find its member through
  -- the Sale List, exactly like the app's Add forms (findCustomerByOrderNumber)
  -- — the "001-####" order numbers never match customers.order_number.
  if c.id is null and nullif(trim(j.order_no), '') is not null then
    select cu.* into c
      from public.sale_list_entries s
      join public.customers cu on cu.id = s.customer_id
      where trim(s.order_number) = trim(j.order_no)
      order by s.created_at desc
      limit 1;
  end if;
  v_order := coalesce(nullif(trim(j.order_no), ''), nullif(trim(c.order_number), ''));
  -- Nothing to identify the record by.
  if v_order is null and c.id is null then
    return null;
  end if;
  v_account := coalesce(nullif(trim(c.company_name), ''), nullif(trim(c.full_name), ''), '');
  v_address := coalesce(nullif(trim(j.secondary_address), ''), c.address, '');
  v_contact := coalesce(c.contact_number, '');
  v_tech := coalesce(j.technician, '');
  v_tech2 := case when v_tech = '' then '' else coalesce(j.technician_2, '') end;

  if j.job_type = 'filter_change' then
    if exists (select 1 from public.filter_change_plans where schedule_job_id = j.id) then
      return null;
    end if;
    select id into v_id from public.filter_change_plans
      where schedule_job_id is null
        and status = 'Pending'
        and ((v_order is not null and order_number = v_order) or (c.id is not null and customer_id = c.id))
        and abs(coalesce(pre_d, plan_date) - j.scheduled_date) <= 60
      order by abs(coalesce(pre_d, plan_date) - j.scheduled_date), created_at
      limit 1;
    if v_id is not null then
      update public.filter_change_plans set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end,
        filter_type = case when coalesce(j.filter_codes, '') <> '' then j.filter_codes else filter_type end,
        member_account = case when trim(member_account) = '' then v_account else member_account end,
        address = case when trim(coalesce(address, '')) = '' then v_address else address end,
        contact_number = case when trim(coalesce(contact_number, '')) = '' then v_contact else contact_number end,
        customer_id = coalesce(customer_id, c.id)
      where id = v_id;
      return 'filter_change_plans:linked';
    end if;
    insert into public.filter_change_plans
      (order_number, member_account, filter_type, plan_date, pre_d, contact_number, address,
       serviceman, serviceman_2, note, customer_id, schedule_job_id)
    values
      (coalesce(v_order, ''), v_account, coalesce(j.filter_codes, ''),
       j.scheduled_date, j.scheduled_date, v_contact, v_address, v_tech, v_tech2, j.notes, c.id, j.id);
    return 'filter_change_plans:created';

  elsif j.job_type = 'installation' then
    if exists (select 1 from public.install_plans where schedule_job_id = j.id) then
      return null;
    end if;
    if v_order is not null then
      select id into v_id from public.install_plans
        where schedule_job_id is null
          and status = 'Pending'
          and installed_date is null
          and order_no = v_order
          and abs(coalesce(pre_installed_date, input_date) - j.scheduled_date) <= 60
        order by abs(coalesce(pre_installed_date, input_date) - j.scheduled_date), created_at
        limit 1;
    end if;
    if v_id is not null then
      update public.install_plans set
        schedule_job_id = j.id,
        pre_installed_date = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end,
        name = case when trim(coalesce(name, '')) = '' then v_account else name end,
        address = case when trim(coalesce(address, '')) = '' then v_address else address end,
        contact_number = case when trim(coalesce(contact_number, '')) = '' then v_contact else contact_number end
      where id = v_id;
      return 'install_plans:linked';
    end if;
    insert into public.install_plans
      (name, order_no, input_date, pre_installed_date, address, contact_number,
       serviceman, serviceman_2, note, member_account_number, schedule_job_id)
    values
      (v_account, coalesce(v_order, ''), j.scheduled_date, j.scheduled_date, v_address, v_contact,
       v_tech, v_tech2, j.notes, coalesce(c.member_account_number, ''), j.id);
    return 'install_plans:created';

  elsif j.job_type = 'repair' then
    if exists (select 1 from public.repair_plans where schedule_job_id = j.id) then
      return null;
    end if;
    if v_order is not null then
      select id into v_id from public.repair_plans
        where schedule_job_id is null
          and status = 'Pending'
          and order_no = v_order
          and abs(coalesce(pre_d, issued_date) - j.scheduled_date) <= 60
        order by abs(coalesce(pre_d, issued_date) - j.scheduled_date), created_at
        limit 1;
    end if;
    if v_id is not null then
      update public.repair_plans set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        th = case when v_tech <> '' then v_tech else th end,
        th_2 = case when v_tech <> '' then v_tech2 else th_2 end,
        account_name = case when trim(coalesce(account_name, '')) = '' then v_account else account_name end,
        address = case when trim(coalesce(address, '')) = '' then v_address else address end,
        contact_number = case when trim(coalesce(contact_number, '')) = '' then v_contact else contact_number end
      where id = v_id;
      return 'repair_plans:linked';
    end if;
    insert into public.repair_plans
      (account_name, order_no, issued_date, pre_d, address, contact_number, th, th_2, note, schedule_job_id)
    values
      (v_account, coalesce(v_order, ''), j.scheduled_date, j.scheduled_date, v_address, v_contact,
       v_tech, v_tech2, j.notes, j.id);
    return 'repair_plans:created';

  else -- collection
    if exists (select 1 from public.collections where schedule_job_id = j.id) then
      return null;
    end if;
    select id into v_id from public.collections
      where schedule_job_id is null
        and status = 'Pending'
        and not collected
        and ((v_order is not null and order_no = v_order) or (c.id is not null and customer_id = c.id))
        and abs(coalesce(pre_d, collection_date) - j.scheduled_date) <= 60
      order by abs(coalesce(pre_d, collection_date) - j.scheduled_date), created_at
      limit 1;
    if v_id is not null then
      update public.collections set
        schedule_job_id = j.id,
        pre_d = j.scheduled_date,
        serviceman = case when v_tech <> '' then v_tech else serviceman end,
        serviceman_2 = case when v_tech <> '' then v_tech2 else serviceman_2 end,
        account_name = case when trim(coalesce(account_name, '')) = '' then v_account else account_name end,
        customer_id = coalesce(customer_id, c.id)
      where id = v_id;
      return 'collections:linked';
    end if;
    insert into public.collections
      (order_no, account_name, collection_date, pre_d, serviceman, serviceman_2, note, customer_id, schedule_job_id)
    values
      (coalesce(v_order, ''), v_account, j.scheduled_date, j.scheduled_date, v_tech, v_tech2, j.notes, c.id, j.id);
    return 'collections:created';
  end if;
end;
$$;

-- Backfill: pending, job-linked records with a blank Account Name.
with member as (
  select distinct on (trim(s.order_number)) trim(s.order_number) as order_no, cu.id, cu.address, cu.contact_number,
         coalesce(nullif(trim(cu.company_name), ''), nullif(trim(cu.full_name), ''), '') as account
  from public.sale_list_entries s
  join public.customers cu on cu.id = s.customer_id
  order by trim(s.order_number), s.created_at desc
)
update public.filter_change_plans p set
  member_account = m.account,
  address = case when trim(coalesce(p.address, '')) = '' then coalesce(m.address, '') else p.address end,
  contact_number = case when trim(coalesce(p.contact_number, '')) = '' then coalesce(m.contact_number, '') else p.contact_number end,
  customer_id = coalesce(p.customer_id, m.id)
from member m
where m.order_no = trim(p.order_number)
  and p.status = 'Pending' and p.schedule_job_id is not null
  and trim(coalesce(p.member_account, '')) = ''
  and m.account <> '';
