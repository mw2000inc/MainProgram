-- A repair's Model = the order's Product # on the Sale List, when left empty.
--
-- Why: the Repair form only filled Model from the member's dispenser type,
-- which no member involved had set, and repairs created another way (an
-- approved schedule job, the Release Slip) never filled it at all — 10 of
-- 395 repairs had no Model, though every one's order has a Product # on the
-- Sale List (e.g. "105 / MW) Oasis-T1").
--
-- 1. BEFORE INSERT: a new repair with no Model gets its order's Product #.
-- 2. Back-fill: existing repairs with no Model get it the same way.
--
-- Only while the repair has no replacement IN/OUT: with IN/OUT set, Model is
-- the replacement unit that queue_repair_unit_inventory (20261106000000)
-- queues in Inventory, so filling it there would add a stock item nobody
-- entered. Those are left as they are (3 today: 001-0398, 001-0285,
-- 001-0244) for the admin to fill by hand.
--
-- Running this changes the existing repairs in step 2 (7 today: Model only).
-- No Inventory item is queued by it (IN/OUT is empty on every one changed).

create or replace function public.repair_model_from_sale_list()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(trim(NEW.model), '') = ''
     and coalesce(trim(NEW.in_out), '') not in ('IN', 'OUT')
     and coalesce(trim(NEW.order_no), '') <> '' then
    select nullif(trim(e.product_no), '') into NEW.model
    from public.sale_list_entries e
    where trim(e.order_number) = trim(NEW.order_no)
      and coalesce(trim(e.product_no), '') <> ''
    order by e.created_at desc
    limit 1;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_repair_model_from_sale_list on public.repair_plans;
create trigger trg_repair_model_from_sale_list
  before insert on public.repair_plans
  for each row execute function public.repair_model_from_sale_list();

-- 2. Existing repairs with no Model (and no replacement IN/OUT).
update public.repair_plans r
set model = (
  select trim(x.product_no)
  from public.sale_list_entries x
  where trim(x.order_number) = trim(r.order_no)
    and coalesce(trim(x.product_no), '') <> ''
  order by x.created_at desc
  limit 1
)
where coalesce(trim(r.model), '') = ''
  and coalesce(trim(r.in_out), '') not in ('IN', 'OUT')
  and exists (
    select 1 from public.sale_list_entries x
    where trim(x.order_number) = trim(r.order_no)
      and coalesce(trim(x.product_no), '') <> ''
  );
