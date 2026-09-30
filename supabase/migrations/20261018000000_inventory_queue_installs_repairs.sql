-- Brings Installs and every recorded Repair part into the Inventory Approvals
-- queue, alongside Filter Changes (filter_change_inventory_queue migration).
--
-- The gap, checked live: install models are not products in inventory (none
-- of the 8 in use, e.g. '201-BK / SK) Standard K (black)'), and 496 of the
-- 500 recorded repair parts were typed in by hand (custom_part_no/name, no
-- product_id) — so nearly none of them could ever be queued, since a stock
-- movement required a product. Now such an item is queued anyway, carrying
-- what was recorded (item_label), and the admin maps it to the right stock
-- item in the queue before approving. A product is still required the moment
-- a movement is approved — nothing unmapped can ever touch stock.
--
-- Safe for every existing stock trigger: apply_stock_movement(),
-- apply_stock_movement_update(), the approval trigger and
-- reverse_stock_movement() all act only on approved rows.

-- =========================================================================
-- 1. stock_movements: an unmapped pending item, and the install it's for.
-- =========================================================================
alter table public.stock_movements alter column product_id drop not null;

alter table public.stock_movements
  add column if not exists item_label text,
  add column if not exists install_plan_id uuid references public.install_plans(id) on delete set null;

create index if not exists stock_movements_install_plan_id_idx on public.stock_movements (install_plan_id);

alter table public.stock_movements drop constraint if exists stock_movements_approved_needs_product;
alter table public.stock_movements
  add constraint stock_movements_approved_needs_product check (status <> 'approved' or product_id is not null);

-- =========================================================================
-- 2. Repairs: queue every recorded part, not only catalog products. A
--    hand-typed part is matched to a product by its part no. (= SKU) when
--    one exists, else queued unmapped with its part no. / name as the label.
--    Direction unchanged: 'IN' (fitted into the unit) takes it out of
--    stock, 'OUT' (taken out of the unit) puts it back.
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
begin
  if exists (select 1 from public.stock_movements where repair_plan_part_id = new.id) then
    return new;
  end if;

  v_product_id := new.product_id;
  if v_product_id is null and coalesce(trim(new.custom_part_no), '') <> '' then
    select id into v_product_id from public.products where trim(sku) = trim(new.custom_part_no) order by date_added limit 1;
  end if;
  v_label := nullif(concat_ws(' / ', nullif(trim(new.custom_part_no), ''), nullif(trim(new.custom_part_name), '')), '');
  if v_product_id is null and v_label is null then
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
    case when new.in_out = 'OUT' then round(new.quantity)::integer else 0 end,
    case when new.in_out = 'IN' then round(new.quantity)::integer else 0 end,
    'Repair',
    auth.uid(),
    coalesce(v_repair_order_no, new.repair_plan_id::text),
    new.id,
    'pending'
  );

  return new;
end;
$$;

-- =========================================================================
-- 3. Installs: when an install gets its Installed Date, queue one unit of
--    its model — matched to a product by the model's code (the part before
--    " / ", e.g. '106' of '106 / MW) Oasis-S2') when one exists, else
--    unmapped with the model as the label. Never queued twice; clearing the
--    Installed Date removes a still-pending item (approved/rejected stay).
--    Checked live: installs keep status 'Pending' even once installed, so
--    the Installed Date is the signal, not the status.
-- =========================================================================
create or replace function public.queue_install_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_product_id uuid;
  v_code text;
begin
  if new.installed_date is not null and (TG_OP = 'INSERT' or old.installed_date is null) then
    if coalesce(trim(new.model), '') = ''
       or exists (select 1 from public.stock_movements where install_plan_id = new.id) then
      return new;
    end if;
    v_code := trim(split_part(new.model, ' / ', 1));
    select id into v_product_id from public.products where trim(sku) = v_code order by date_added limit 1;
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, install_plan_id, status
    )
    values (
      new.installed_date,
      v_product_id,
      trim(new.model),
      0,
      1,
      'Installation',
      auth.uid(),
      coalesce(nullif(new.order_no, ''), new.id::text),
      new.id,
      'pending'
    );
  elsif TG_OP = 'UPDATE' and old.installed_date is not null and new.installed_date is null then
    delete from public.stock_movements where install_plan_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_queue_install_inventory on public.install_plans;
create trigger trg_queue_install_inventory
  after insert or update of installed_date on public.install_plans
  for each row execute function public.queue_install_inventory();

-- Not backfilled: installs and repair parts recorded before this migration
-- (14 installed, 496 hand-typed parts) aren't queued retroactively.
