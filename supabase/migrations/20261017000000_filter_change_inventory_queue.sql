-- Completing a Filter Change visit queues its filters for inventory
-- deduction, pending an admin's approval — never deducting stock directly.
--
-- Before this, only a schedule job's recorded filter items
-- (schedule_job_filter_items, see ct_filter_change_collection_inventory_link)
-- and a repair's recorded parts (repair_plan_parts_stock_movement) created
-- pending stock movements. A Filter Change visit marked Completed — or given
-- an Acc D, which now sets Completed with it — never reached inventory at
-- all, even though its Filter already says exactly which filters were due.
--
-- Same pending -> approved flow as those paths: a row inserted here has
-- status 'pending' (apply_stock_movement() skips it), shows up in the
-- Inventory Approvals queue, and only an admin's approval (the existing
-- stock_movement_approved trigger) actually changes products.stock_quantity.
-- Rejecting it leaves stock alone.
--
-- Install visits aren't included: checked live, none of the 8 install models
-- (106 / MW) Oasis-S2, 102 / MW) F5, ...) is a product in inventory, so
-- there is nothing to deduct.

-- =========================================================================
-- 1. Link a movement to the visit that queued it (idempotency, and so the
--    queue can show the visit's customer / technician / completed date).
-- =========================================================================
alter table public.stock_movements
  add column if not exists filter_change_plan_id uuid references public.filter_change_plans(id) on delete set null;

create index if not exists stock_movements_filter_change_plan_id_idx
  on public.stock_movements (filter_change_plan_id);

-- =========================================================================
-- 2. The trigger. A visit counts as completed when its status is Completed
--    or it has an Acc D (and it isn't Cancelled).
--
--    Becoming completed: one pending movement per filter code in its Filter
--    that matches a product's SKU (quantity = how many times the code is
--    listed), dated its Acc D. Codes with no matching product (checked
--    live: only 1152) are skipped — the queue lists them as "not in
--    inventory". Skipped entirely when:
--      - this visit already has movements (re-completing never queues twice)
--      - it came from a schedule job whose recorded filter items already
--        queued movements (the C/T path — same filters, don't count twice)
--
--    No longer completed (Acc D cleared / status back to Pending): its
--    still-pending movements are removed. Approved or rejected ones stay —
--    those are an admin's decision and already part of stock history.
--
--    security definer: a technician marking a visit done can't write
--    stock_movements themselves (admin-only RLS).
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
      continue when v_product_id is null;
      insert into public.stock_movements (
        date, product_id, quantity_added, quantity_removed,
        reason, user_id, reference_number, filter_change_plan_id, status
      )
      values (
        coalesce(NEW.acc_d, current_date),
        v_product_id,
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
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_queue_filter_change_inventory on public.filter_change_plans;
create trigger trg_queue_filter_change_inventory
  after insert or update of status, acc_d on public.filter_change_plans
  for each row execute function public.queue_filter_change_inventory();

-- Not backfilled: visits completed before this migration (checked live: 1)
-- are left as they are, rather than suddenly queueing old deductions.
