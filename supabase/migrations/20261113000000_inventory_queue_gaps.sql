-- Inventory queue gaps: every part / filter a completed job used now reaches
-- Inventory as a pending movement for an admin to approve.
--
-- Checked live on 2026-10-16:
--   * Repairs whose parts were typed only in Part No ("013,014,012") — with no
--     repair part lines — queued nothing: only part lines (20261106000000)
--     and replacement units made movements. 001-0398 / 001-0399
--     (Maxicare_Fairview, completed Oct 16) showed their parts on the Release
--     Slip but had nothing in Inventory.
--   * A Filter Change code with no product at the time was skipped silently:
--     001-0914 / 001-0915 (filter 1152, completed Oct 5 — product 1152 was
--     only added on Oct 7) never queued. Repairs and installs already queue
--     such an item unmapped (item_label) for the admin to map
--     (20261018000000); filter changes now do the same.
--
-- 1. Repair Part No: when a repair is completed (Completed or Acc D, not
--    Cancelled) and has a Part No but no repair part lines, each code is
--    queued OUT — quantity = times listed, matched to a product by SKU (the
--    earliest added) or left unmapped with the code as its label; reason
--    'Repair', linked to the repair (repair_plan_id) and its schedule job
--    (so the Release Slip shows it), dated Acc D, else Pre D, else Issued
--    Date; reference = Order No. Unit IN/OUT is where the customer's machine
--    is, not a stock direction, so parts always go OUT. While still pending,
--    the queued lines follow edits to Part No / the dates and are removed if
--    the repair is un-completed, cancelled, its Part No cleared, or part lines
--    are added (those queue themselves — no double count). Once an admin has
--    approved or rejected any of them, they're never touched again. Only
--    repairs from 2026-10-03 on. The replacement-unit rule now touches only
--    its own 'Repair Unit' rows — before, it would have deleted these.
-- 2. Filter Change records (queue_filter_change_inventory) and unlinked
--    Filter Change jobs (queue_unlinked_job_filter_codes): a code with no
--    product is queued unmapped instead of skipped. Everything else as in
--    20261019000000 / 20261105000000.
-- 3. One-time catch-up (only rows completed since 2026-10-03, when queuing
--    began): the repairs and filter changes above that have no movement yet.
--
-- Stock changes only on approval, as always; an unmapped row can't be
-- approved until it's mapped (stock_movements_approved_needs_product).

-- =========================================================================
-- 1. Repair Part No
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
begin
  v_done := NEW.status <> 'Cancelled' and (NEW.status = 'Completed' or NEW.acc_d is not null);

  -- Reviewed already (approved / rejected): leave everything as it is.
  if exists (
    select 1 from public.stock_movements
    where repair_plan_id = NEW.id and repair_plan_part_id is null and reason = 'Repair' and status <> 'pending'
  ) then
    return null;
  end if;

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
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, repair_plan_id, schedule_job_id, status
    )
    values (
      coalesce(NEW.acc_d, NEW.pre_d, NEW.issued_date, (now() at time zone 'Asia/Manila')::date),
      v_product_id,
      case when v_product_id is null then v_code.code end,
      0,
      v_code.qty,
      'Repair',
      auth.uid(),
      coalesce(nullif(trim(NEW.order_no), ''), NEW.id::text),
      NEW.id,
      NEW.schedule_job_id,
      'pending'
    );
  end loop;
  return null;
end;
$$;

-- The replacement-unit rule (20261106000000) treated EVERY movement linked to
-- the repair as its unit movement: with no unit it deleted all of them, and
-- otherwise updated the first one. It now handles only its own 'Repair Unit'
-- rows, so it leaves the Part No lines alone. Unchanged otherwise.
create or replace function public.queue_repair_unit_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_dir text := upper(trim(coalesce(new.in_out, '')));
  v_model text := trim(coalesce(new.model, ''));
  v_date date := coalesce(new.acc_d, new.pre_d, new.issued_date);
  v_product_id uuid;
  v_existing record;
begin
  if v_dir not in ('IN', 'OUT') or v_model = '' or new.status = 'Cancelled' then
    delete from public.stock_movements where repair_plan_id = new.id and reason = 'Repair Unit' and status = 'pending';
    return new;
  end if;

  select id, status into v_existing from public.stock_movements
    where repair_plan_id = new.id and reason = 'Repair Unit' order by created_at limit 1;
  select id into v_product_id from public.products where trim(sku) = trim(split_part(v_model, ' / ', 1)) order by date_added limit 1;

  if v_existing.id is null then
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, repair_plan_id, status
    )
    values (
      coalesce(v_date, current_date),
      v_product_id,
      v_model,
      case when v_dir = 'IN' then 1 else 0 end,
      case when v_dir = 'OUT' then 1 else 0 end,
      'Repair Unit',
      auth.uid(),
      coalesce(nullif(trim(new.order_no), ''), new.id::text),
      new.id,
      'pending'
    );
  elsif v_existing.status = 'pending' then
    update public.stock_movements set
      date = coalesce(v_date, date),
      item_label = v_model,
      product_id = case
        when TG_OP = 'UPDATE' and trim(coalesce(old.model, '')) = v_model then coalesce(product_id, v_product_id)
        else v_product_id
      end,
      quantity_added = case when v_dir = 'IN' then 1 else 0 end,
      quantity_removed = case when v_dir = 'OUT' then 1 else 0 end,
      reference_number = coalesce(nullif(trim(new.order_no), ''), reference_number)
    where id = v_existing.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_queue_repair_part_no_inventory on public.repair_plans;
create trigger trg_queue_repair_part_no_inventory
  after insert or update of status, acc_d, pre_d, issued_date, part_no on public.repair_plans
  for each row execute function public.queue_repair_part_no_inventory();

-- Part lines added later queue themselves (20261106000000): drop the
-- still-pending Part No lines of that repair so nothing is counted twice.
create or replace function public.drop_repair_part_no_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.stock_movements
    where repair_plan_id = NEW.repair_plan_id and repair_plan_part_id is null and reason = 'Repair' and status = 'pending';
  return null;
end;
$$;

drop trigger if exists trg_drop_repair_part_no_inventory on public.repair_plan_parts;
create trigger trg_drop_repair_part_no_inventory
  after insert on public.repair_plan_parts
  for each row execute function public.drop_repair_part_no_inventory();

-- =========================================================================
-- 2a. Filter Change records: unknown codes queued unmapped
-- =========================================================================
create or replace function public.queue_filter_change_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_completed boolean;
  v_was_completed boolean := false;
  v_code record;
  v_product_id uuid;
begin
  v_completed := NEW.status <> 'Cancelled' and (NEW.status = 'Completed' or NEW.acc_d is not null);
  if TG_OP = 'UPDATE' then
    v_was_completed := OLD.status <> 'Cancelled' and (OLD.status = 'Completed' or OLD.acc_d is not null);
  end if;

  if v_completed and not v_was_completed then
    if exists (select 1 from public.stock_movements where filter_change_plan_id = NEW.id) then
      return NEW;
    end if;
    if NEW.schedule_job_id is not null
       and exists (select 1 from public.stock_movements where schedule_job_id = NEW.schedule_job_id) then
      return NEW;
    end if;

    for v_code in
      select trim(code) as code, count(*)::integer as qty
      from unnest(string_to_array(coalesce(NEW.filter_type, ''), ',')) as code
      where trim(code) <> ''
      group by trim(code)
    loop
      select id into v_product_id from public.products where trim(sku) = v_code.code order by date_added limit 1;
      insert into public.stock_movements (
        date, product_id, item_label, quantity_added, quantity_removed,
        reason, user_id, reference_number, filter_change_plan_id, status
      )
      values (
        coalesce(NEW.acc_d, current_date),
        v_product_id,
        case when v_product_id is null then v_code.code end,
        0,
        v_code.qty,
        'Filter Change',
        auth.uid(),
        coalesce(nullif(NEW.order_number, ''), NEW.id::text),
        NEW.id,
        'pending'
      );
    end loop;
  elsif TG_OP = 'UPDATE' and v_was_completed and not v_completed then
    delete from public.stock_movements where filter_change_plan_id = NEW.id and status = 'pending';
  elsif TG_OP = 'UPDATE' and v_completed and NEW.acc_d is not null and NEW.acc_d is distinct from OLD.acc_d then
    update public.stock_movements set date = NEW.acc_d
      where filter_change_plan_id = NEW.id and status = 'pending';
  end if;

  return NEW;
end;
$$;

-- =========================================================================
-- 2b. Unlinked Filter Change jobs: unknown codes queued unmapped
-- =========================================================================
create or replace function public.queue_unlinked_job_filter_codes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code record;
  v_product_id uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if NEW.status <> 'completed' or OLD.status = 'completed' then
    return null;
  end if;
  if NEW.job_type <> 'filter_change' or trim(coalesce(NEW.filter_codes, '')) = '' then
    return null;
  end if;
  if exists (select 1 from public.filter_change_plans where schedule_job_id = NEW.id) then
    return null;
  end if;
  if exists (select 1 from public.stock_movements where schedule_job_id = NEW.id) then
    return null;
  end if;

  for v_code in
    select trim(code) as code, count(*)::integer as qty
    from unnest(string_to_array(NEW.filter_codes, ',')) as code
    where trim(code) <> ''
    group by trim(code)
  loop
    select id into v_product_id from public.products where trim(sku) = v_code.code order by date_added limit 1;
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, schedule_job_id, status
    )
    values (
      v_today,
      v_product_id,
      case when v_product_id is null then v_code.code end,
      0,
      v_code.qty,
      'Filter Change',
      auth.uid(),
      coalesce(nullif(trim(NEW.order_no), ''), NEW.id::text),
      NEW.id,
      'pending'
    );
  end loop;
  return null;
end;
$$;

-- =========================================================================
-- 3. One-time catch-up (completed since 2026-10-03, nothing queued yet)
-- =========================================================================
-- Repairs: re-run the Part No rule on each (the update fires the trigger).
update public.repair_plans r
  set part_no = r.part_no
  where r.status <> 'Cancelled'
    and (r.status = 'Completed' or r.acc_d is not null)
    and coalesce(r.acc_d, r.pre_d, r.issued_date) >= date '2026-10-03'
    and trim(coalesce(r.part_no, '')) <> ''
    and not exists (select 1 from public.repair_plan_parts p where p.repair_plan_id = r.id)
    and not exists (select 1 from public.stock_movements m where m.repair_plan_id = r.id)
    and not (r.schedule_job_id is not null and exists (select 1 from public.stock_movements m where m.schedule_job_id = r.schedule_job_id));

-- Filter Change records: queue their codes (same rule as 2a).
insert into public.stock_movements (
  date, product_id, item_label, quantity_added, quantity_removed,
  reason, user_id, reference_number, filter_change_plan_id, status
)
select
  coalesce(f.acc_d, current_date),
  p.id,
  case when p.id is null then c.code end,
  0,
  c.qty,
  'Filter Change',
  null,
  coalesce(nullif(f.order_number, ''), f.id::text),
  f.id,
  'pending'
from public.filter_change_plans f
cross join lateral (
  select trim(code) as code, count(*)::integer as qty
  from unnest(string_to_array(coalesce(f.filter_type, ''), ',')) as code
  where trim(code) <> ''
  group by trim(code)
) c
left join lateral (
  select pr.id from public.products pr where trim(pr.sku) = c.code order by pr.date_added limit 1
) p on true
where f.status <> 'Cancelled'
  and (f.status = 'Completed' or f.acc_d is not null)
  and f.acc_d >= date '2026-10-03'
  and not exists (select 1 from public.stock_movements m where m.filter_change_plan_id = f.id)
  and not (f.schedule_job_id is not null and exists (select 1 from public.stock_movements m where m.schedule_job_id = f.schedule_job_id));
