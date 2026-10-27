-- An item already Approved or Rejected can be decided again on the Inventory
-- List (Jan and cashout only — the app shows them the buttons): a Rejected one
-- approved, an Approved one rejected. Stock follows:
--
-- 1. Approving applied stock only for 'pending' → 'approved'. Now any
--    not-yet-approved status → 'approved' does (so Rejected → Approved takes
--    the item out of / into stock like a first approval).
-- 2. New: 'approved' → anything else (Rejected) gives back what the approval
--    did (the reverse of apply_stock_movement_approval), on the product it
--    was applied to.
--
-- Running this changes no rows: it redefines one trigger and adds one.

drop trigger if exists stock_movement_approved on public.stock_movements;
create trigger stock_movement_approved
  after update on public.stock_movements
  for each row
  when (old.status <> 'approved' and new.status = 'approved')
  execute function public.apply_stock_movement_approval();

create or replace function public.reverse_stock_movement_unapproval()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.product_id is not null then
    update public.products
      set stock_quantity = stock_quantity - (old.quantity_added - old.quantity_removed),
          last_updated = new.date
      where id = old.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists stock_movement_unapproved on public.stock_movements;
create trigger stock_movement_unapproved
  after update on public.stock_movements
  for each row
  when (old.status = 'approved' and new.status <> 'approved')
  execute function public.reverse_stock_movement_unapproval();
