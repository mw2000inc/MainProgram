-- Real reject/decline for a pending stock movement. Previously
-- stock_movements.status only allowed 'pending'/'approved' (see the
-- ct_filter_change_collection_inventory_link migration) — an admin's only
-- way to not approve something was leaving it pending forever, or deleting
-- it outright, which leaves zero trace in stock_movements itself and isn't
-- a reliable "this was deliberately rejected" signal (a delete could just
-- as easily be cleaning up a duplicate or a mistake — see two real
-- historical examples of this found in activity_logs while investigating
-- StockMovementHistoryDialog).
--
-- Widens the check constraint to add 'rejected', and adds
-- rejected_by/rejected_at — mirroring approved_by/approved_at exactly
-- (same type, same FK, same nullability) rather than overloading those
-- columns with a rejection's actor/timestamp under a name that would then
-- read backwards ("approved_by: Jane" for something Jane actually
-- rejected).
--
-- No new trigger logic needed for the actual stock effect, and none of the
-- existing triggers need touching: every trigger that reacts to a status
-- change is already scoped specifically to a 'pending' -> 'approved'
-- transition, never "any status change away from pending" —
-- apply_stock_movement_approval()'s own trigger fires
-- `when (old.status = 'pending' and new.status = 'approved')`, which can
-- structurally never match a pending -> rejected transition. So rejecting
-- a movement is already guaranteed, by the existing trigger definitions
-- alone, to leave products.stock_quantity completely untouched — it never
-- applies the quantity and then needs to undo it, it just never applies it
-- at all. Confirmed by reading every trigger that touches
-- products.stock_quantity (apply_stock_movement,
-- apply_stock_movement_approval, apply_stock_movement_update,
-- reverse_stock_movement) before writing this migration.
alter table public.stock_movements
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz;

alter table public.stock_movements drop constraint if exists stock_movements_status_check;
alter table public.stock_movements
  add constraint stock_movements_status_check check (status in ('pending', 'approved', 'rejected'));
