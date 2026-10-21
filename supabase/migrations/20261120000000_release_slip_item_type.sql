-- Which job type a Release Slip item belongs to (the F / R / S / O box ticked
-- on its line), so one order can carry items for several types — e.g. 012,
-- 013, 017 for a Repair (R) and 019, 413, 415 for an Installation (S) — and
-- the Daily Report shows each item under its type.
--
-- 1. stock_movements.slip_type: 'F' (Filter Change), 'R' (Repair),
--    'S' (Installation), 'O' (Other / Collection); empty = the job's own type.
-- 2. get_release_slip returns each item's slip_type (redefined from
--    20261119000000 — only that field is added).
--
-- 3. queue_repair_part_no_inventory (20261113000000) rebuilds a repair's
--    still-pending Part No lines whenever the repair is saved. The rebuilt
--    lines now keep who added each part (user_id — the technician who typed
--    it on the Release Slip), its "For" (purpose) and its type box
--    (slip_type), instead of becoming "System (Auto)" / the admin who edited
--    the repair later. Otherwise unchanged.
--
-- Running this adds one empty column and redefines two functions; no rows
-- change.

alter table public.stock_movements add column if not exists slip_type text;
alter table public.stock_movements drop constraint if exists stock_movements_slip_type_check;
alter table public.stock_movements
  add constraint stock_movements_slip_type_check check (slip_type is null or slip_type in ('F', 'R', 'S', 'O'));

create or replace function public.get_release_slip(
  p_date date,
  p_technician_user_id uuid default null,
  p_include_pending boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_target uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select exists (select 1 from public.profiles where id = v_uid and role = 'admin') into v_is_admin;
  -- A technician always gets their own slip, whatever was asked for.
  v_target := case when v_is_admin then p_technician_user_id else v_uid end;

  select jsonb_build_object(
    'technician_name', (select name from public.profiles where id = v_target),
    'jobs', coalesce(jsonb_agg(job_row order by job_row->>'technician', job_row->>'order_no'), '[]'::jsonb)
  )
  into v_result
  from (
    select jsonb_build_object(
      'job_id', j.id,
      'order_no', coalesce(j.order_no, ''),
      'account_name', coalesce(
        nullif(c.company_name, ''), nullif(c.full_name, ''),
        nullif(fc.member_account, ''), nullif(col.account_name, ''), nullif(ip.name, ''), nullif(rp.account_name, ''),
        nullif(split_part(coalesce(j.notes, ''), ' — ', 1), ''),
        ''
      ),
      'job_type', j.job_type::text,
      'status', case when j.status::text = 'completed' or d.record_done then 'completed' else j.status::text end,
      'scheduled_date', j.scheduled_date,
      'technician', coalesce(j.technician, ''),
      'technician_2', coalesce(j.technician_2, ''),
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', coalesce(p.sku, ''),
                 'label', coalesce(m.item_label, p.name, ''),
                 'qty_out', coalesce(m.quantity_removed, 0),
                 'qty_in', coalesce(m.quantity_added, 0),
                 'status', m.status,
                 'purpose', coalesce(m.purpose, ''),
                 'slip_type', coalesce(m.slip_type, '')
               ) order by coalesce(p.sku, m.item_label, ''), m.created_at)
        from public.stock_movements m
        left join public.products p on p.id = m.product_id
        where m.status is distinct from 'rejected'
          and (
            m.schedule_job_id = j.id
            or m.filter_change_plan_id in (select f.id from public.filter_change_plans f where f.schedule_job_id = j.id)
            or m.install_plan_id in (select i.id from public.install_plans i where i.schedule_job_id = j.id)
            or m.repair_plan_part_id in (
              select pp.id from public.repair_plan_parts pp
              join public.repair_plans r on r.id = pp.repair_plan_id
              where r.schedule_job_id = j.id
            )
          )
      ), '[]'::jsonb)
    ) as job_row
    from public.schedule_jobs j
    left join lateral (
      select c1.company_name, c1.full_name from public.customers c1
      where c1.id = j.customer_id
         or (j.customer_id is null and nullif(trim(j.order_no), '') is not null and (
              c1.id = (select e.customer_id from public.sale_list_entries e where e.order_number = trim(j.order_no) and e.customer_id is not null limit 1)
              or trim(c1.order_number) = trim(j.order_no)))
      order by (c1.id = j.customer_id) desc nulls last
      limit 1
    ) c on true
    left join lateral (select f.member_account from public.filter_change_plans f where f.schedule_job_id = j.id limit 1) fc on true
    left join lateral (select x.account_name from public.collections x where x.schedule_job_id = j.id limit 1) col on true
    left join lateral (select i.name from public.install_plans i where i.schedule_job_id = j.id limit 1) ip on true
    left join lateral (select r.account_name from public.repair_plans r where r.schedule_job_id = j.id limit 1) rp on true
    -- Done on its record: an approved ('pending') job whose Filter Change /
    -- Collection / Installation / Repair record is already completed.
    left join lateral (
      select j.status::text = 'pending' and (
        exists (select 1 from public.filter_change_plans f where f.schedule_job_id = j.id and (f.status = 'Completed' or f.acc_d is not null))
        or exists (select 1 from public.collections x where x.schedule_job_id = j.id and (x.collected or x.status = 'Collected'))
        or exists (select 1 from public.install_plans i where i.schedule_job_id = j.id and i.status = 'Completed')
        or exists (select 1 from public.repair_plans r where r.schedule_job_id = j.id and r.status = 'Completed')
      ) as record_done
    ) d on true
    where j.scheduled_date = p_date
      and (j.status::text = 'completed' or d.record_done or (p_include_pending and j.status::text = 'pending'))
      and (v_target is null or j.technician_user_id = v_target or j.technician_2_user_id = v_target)
  ) jobs;

  return v_result;
end;
$$;

revoke all on function public.get_release_slip(date, uuid, boolean) from public;
revoke all on function public.get_release_slip(date, uuid, boolean) from anon;
grant execute on function public.get_release_slip(date, uuid, boolean) to authenticated;

-- =========================================================================
-- 3. Repair Part No lines keep who added them (and their For / type)
-- =========================================================================
create or replace function public.queue_repair_part_no_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_done boolean;
  v_code record;
  v_product_id uuid;
  v_prev jsonb;
  v_key text;
begin
  v_done := NEW.status <> 'Cancelled' and (NEW.status = 'Completed' or NEW.acc_d is not null);

  -- Reviewed already (approved / rejected): leave everything as it is.
  if exists (
    select 1 from public.stock_movements
    where repair_plan_id = NEW.id and repair_plan_part_id is null and reason = 'Repair' and status <> 'pending'
  ) then
    return null;
  end if;

  -- Who added each part (and its For / type box), kept for the rebuilt lines.
  select coalesce(jsonb_object_agg(k, jsonb_build_object('u', u, 'p', pu, 't', st)), '{}'::jsonb)
    into v_prev
    from (
      select distinct on (coalesce(product_id::text, 'label:' || coalesce(item_label, '')))
        coalesce(product_id::text, 'label:' || coalesce(item_label, '')) as k,
        user_id as u, purpose as pu, slip_type as st
      from public.stock_movements
      where repair_plan_id = NEW.id and repair_plan_part_id is null and reason = 'Repair' and status = 'pending'
      order by coalesce(product_id::text, 'label:' || coalesce(item_label, '')), created_at
    ) prev;

  -- Start from a clean slate for this repair's still-pending Part No lines.
  delete from public.stock_movements
    where repair_plan_id = NEW.id and repair_plan_part_id is null and reason = 'Repair' and status = 'pending';

  -- Only repairs from when queuing began (2026-10-03): editing a long-done
  -- old repair never asks for stock that left long ago.
  if not v_done
     or trim(coalesce(NEW.part_no, '')) = ''
     or coalesce(NEW.acc_d, NEW.pre_d, NEW.issued_date) < date '2026-10-03'
     or exists (select 1 from public.repair_plan_parts where repair_plan_id = NEW.id) then
    return null;
  end if;

  for v_code in
    select trim(code) as code, count(*)::integer as qty
    from regexp_split_to_table(NEW.part_no, '[,;/\n]+') as code
    where trim(code) <> ''
    group by trim(code)
  loop
    select id into v_product_id from public.products where trim(sku) = v_code.code order by date_added limit 1;
    v_key := coalesce(v_product_id::text, 'label:' || v_code.code);
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, repair_plan_id, schedule_job_id, status,
      purpose, slip_type
    )
    values (
      coalesce(NEW.acc_d, NEW.pre_d, NEW.issued_date, (now() at time zone 'Asia/Manila')::date),
      v_product_id,
      case when v_product_id is null then v_code.code end,
      0,
      v_code.qty,
      'Repair',
      coalesce(nullif(v_prev -> v_key ->> 'u', '')::uuid, auth.uid()),
      coalesce(nullif(trim(NEW.order_no), ''), NEW.id::text),
      NEW.id,
      NEW.schedule_job_id,
      'pending',
      nullif(v_prev -> v_key ->> 'p', ''),
      nullif(v_prev -> v_key ->> 't', '')
    );
  end loop;
  return null;
end;
$$;
