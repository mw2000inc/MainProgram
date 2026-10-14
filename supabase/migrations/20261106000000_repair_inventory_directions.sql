-- Repair parts and replacement units in the Inventory approval queue, with
-- the direction the admin uses: OUT leaves stock, IN comes back.
--
-- Decided with the admin on 2026-10-14:
--   * Repair PARTS: a part marked OUT is deducted from stock (it went out to
--     the customer's unit); a part marked IN is added back (a defective or
--     returned part brought in). This REVERSES the earlier rule
--     (20261005000000 / 20261018000000: IN deducted, OUT added). Checked
--     live: 351 of 529 recorded parts are OUT — the parts that were used.
--     The movements already waiting for approval get the same correction (2).
--   * Replacement UNIT (repair_plans.in_out + model — the SalesSchedule
--     fields, 20260925000000): OUT deducts one unit of that model, IN adds
--     one back, matched to the product whose SKU is the model's code (before
--     ' / ', like installs) or left unmapped with the model as the label.
--     repair_plans.unit_in_out (the customer's own unit brought In / sent
--     Out) is NOT stock and creates no movement — it's shown as a badge.
--   * Stock still changes only when an admin approves a movement: every
--     stock trigger acts on approved rows only, and an unmapped row can't be
--     approved (stock_movements_approved_needs_product).
--
-- 1. Parts: new movements use the new direction; editing a part (direction,
--    quantity, product / part no., date) keeps its still-pending movement in
--    step (before, only an insert made one and edits were ignored); deleting
--    a part removes its still-pending movement. Approved / rejected rows are
--    never touched.
-- 2. Correction: the still-PENDING movements from repair parts swap their
--    quantity added / removed (29 on 2026-10-14: 18 "added", 11 "removed").
-- 3. Replacement units: queued on save (like installs, 20261024000000),
--    dated Acc D, else Pre D, else the Issued Date; a still-pending movement
--    follows later edits; clearing IN/OUT or the model, cancelling the repair
--    or deleting it removes a still-pending one. Repairs saved before this
--    migration aren't queued retroactively (17 have a replacement-unit
--    IN/OUT, mostly AppSheet history).
-- 4. Realtime: repair_plan_parts joins the realtime publication, so open
--    Daily Reports show a repair's parts as they're recorded.

-- =========================================================================
-- 1. Parts
-- =========================================================================
create or replace function public.handle_repair_plan_part_stock_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_repair_order_no text;
  v_product_id uuid;
  v_label text;
  v_qty integer := greatest(round(new.quantity)::integer, 1);
  v_existing record;
begin
  v_product_id := new.product_id;
  if v_product_id is null and coalesce(trim(new.custom_part_no), '') <> '' then
    select id into v_product_id from public.products where trim(sku) = trim(new.custom_part_no) order by date_added limit 1;
  end if;
  v_label := nullif(concat_ws(' / ', nullif(trim(new.custom_part_no), ''), nullif(trim(new.custom_part_name), '')), '');

  select id, status into v_existing from public.stock_movements where repair_plan_part_id = new.id order by created_at limit 1;

  if TG_OP = 'UPDATE' then
    if v_existing.id is not null and v_existing.status = 'pending' then
      update public.stock_movements set
        date = new.part_date,
        product_id = case when new.product_id is distinct from old.product_id or coalesce(new.custom_part_no, '') is distinct from coalesce(old.custom_part_no, '')
                          then v_product_id else coalesce(product_id, v_product_id) end,
        item_label = v_label,
        quantity_removed = case when new.in_out = 'OUT' then v_qty else 0 end,
        quantity_added = case when new.in_out = 'IN' then v_qty else 0 end
      where id = v_existing.id and status = 'pending';
    end if;
    return new;
  end if;

  if v_existing.id is not null or (v_product_id is null and v_label is null) then
    return new;
  end if;

  select order_no into v_repair_order_no from public.repair_plans where id = new.repair_plan_id;

  insert into public.stock_movements (
    date, product_id, item_label, quantity_added, quantity_removed,
    reason, user_id, reference_number, repair_plan_part_id, status
  )
  values (
    new.part_date,
    v_product_id,
    v_label,
    case when new.in_out = 'IN' then v_qty else 0 end,
    case when new.in_out = 'OUT' then v_qty else 0 end,
    'Repair',
    auth.uid(),
    coalesce(v_repair_order_no, new.repair_plan_id::text),
    new.id,
    'pending'
  );
  return new;
end;
$$;

drop trigger if exists trg_repair_plan_part_stock_movement on public.repair_plan_parts;
create trigger trg_repair_plan_part_stock_movement
  after insert or update of in_out, quantity, product_id, custom_part_no, custom_part_name, part_date on public.repair_plan_parts
  for each row execute function public.handle_repair_plan_part_stock_movement();

create or replace function public.remove_repair_part_inventory_draft()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.stock_movements where repair_plan_part_id = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists trg_remove_repair_part_inventory_draft on public.repair_plan_parts;
create trigger trg_remove_repair_part_inventory_draft
  before delete on public.repair_plan_parts
  for each row execute function public.remove_repair_part_inventory_draft();

-- =========================================================================
-- 2. Correction of the movements already waiting
-- =========================================================================
update public.stock_movements
  set quantity_added = quantity_removed, quantity_removed = quantity_added
  where repair_plan_part_id is not null and status = 'pending';

-- =========================================================================
-- 3. Replacement units
-- =========================================================================
alter table public.stock_movements
  add column if not exists repair_plan_id uuid references public.repair_plans(id) on delete set null;

create index if not exists stock_movements_repair_plan_id_idx on public.stock_movements (repair_plan_id);

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
    delete from public.stock_movements where repair_plan_id = new.id and status = 'pending';
    return new;
  end if;

  select id, status into v_existing from public.stock_movements where repair_plan_id = new.id order by created_at limit 1;
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
      -- keep an admin's own mapping unless the model itself changed
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

drop trigger if exists trg_queue_repair_unit_inventory on public.repair_plans;
create trigger trg_queue_repair_unit_inventory
  after insert or update of in_out, model, acc_d, pre_d, issued_date, order_no, status on public.repair_plans
  for each row execute function public.queue_repair_unit_inventory();

create or replace function public.remove_repair_unit_inventory_draft()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.stock_movements where repair_plan_id = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists trg_remove_repair_unit_inventory_draft on public.repair_plans;
create trigger trg_remove_repair_unit_inventory_draft
  before delete on public.repair_plans
  for each row execute function public.remove_repair_unit_inventory_draft();

-- =========================================================================
-- 4. Realtime: open Daily Reports refresh a repair's parts as they change
--    (stock_movements is already published, 20261020000000).
-- =========================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repair_plan_parts'
     ) then
    alter publication supabase_realtime add table public.repair_plan_parts;
  end if;
end;
$$;
