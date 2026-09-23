-- Recording a Repair Plan part generates a pending stock_movements row, the
-- same "Pending Inventory Approval" pattern schedule_job_filter_items
-- already established for Filter Change (see
-- ct_filter_change_collection_inventory_link.sql): status='pending', zero
-- stock effect until an admin approves it via the existing queue.
--
-- Confirmed with the admin before writing this: repair_plans.unit_in_out
-- (the legacy AppSheet "In"/"Out" field, no product reference at all)
-- cannot drive this -- it doesn't say which item or how many. The Parts
-- table (repair_plan_parts) is the actual source of truth: each row already
-- names a real product_id + quantity + its own in_out, which is everything
-- a stock movement needs. install_plans.in_out was checked too and does
-- nothing like this at all -- no product/inventory link exists there to
-- reuse.
--
-- Direction mapping, confirmed with the admin: IN = a part being installed
-- INTO the customer's unit, consumed from inventory (quantity_removed); OUT
-- = a part coming back OUT of the unit into inventory (quantity_added).
--
-- Only fires when product_id is set -- a custom/typed-only part (see
-- repair_plan_parts_custom_entries.sql) names no real catalog item, so
-- there's nothing to record a movement against; silently skipped, same
-- principle as every other real-product_id-required path in this app.
--
-- Fires on INSERT only, exactly like handle_schedule_job_filter_item() --
-- editing or deleting an already-recorded part afterward does NOT adjust or
-- remove the pending movement it already generated. An admin corrects a
-- mistake the same way they already do for a Filter Change movement:
-- reject/edit the pending row itself in the Pending Inventory Approval
-- queue.
--
-- Idempotent per PART ROW (the new repair_plan_part_id column) rather than
-- per (repair_plan_id, product_id) the way schedule_job_id is: unlike a
-- job's filter items (at most one row per product per job),
-- repair_plan_parts has no such uniqueness -- a repair can legitimately log
-- the same product twice (e.g. one IN, one OUT), so each part row is its
-- own movement.
alter table public.stock_movements
  add column if not exists repair_plan_part_id uuid references public.repair_plan_parts(id) on delete set null;

create or replace function public.handle_repair_plan_part_stock_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_repair_order_no text;
  v_existing_movement uuid;
begin
  if new.product_id is null then
    return new;
  end if;

  select id into v_existing_movement
    from public.stock_movements
    where repair_plan_part_id = new.id
    limit 1;

  if v_existing_movement is not null then
    return new;
  end if;

  select order_no into v_repair_order_no
    from public.repair_plans where id = new.repair_plan_id;

  insert into public.stock_movements (
    date, product_id, quantity_added, quantity_removed,
    reason, user_id, reference_number, repair_plan_part_id, status
  )
  values (
    new.part_date,
    new.product_id,
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

drop trigger if exists trg_repair_plan_part_stock_movement on public.repair_plan_parts;
create trigger trg_repair_plan_part_stock_movement
  after insert on public.repair_plan_parts
  for each row execute function public.handle_repair_plan_part_stock_movement();
