-- Editing or deleting an APPROVED stock movement now needs approval, like a
-- new pending one: the change is stored on the movement as a request and
-- the stock total only changes once an admin approves it in the Daily
-- Report's Inventory List (or wherever pending items are approved).
--
--   pending_action        'edit' or 'delete' (null: nothing waiting)
--   pending_values        for 'edit': the new quantity_added / quantity_removed /
--                         second_hand_ready_quantity / second_hand_repair_quantity /
--                         demo_quantity / reason
--   pending_requested_by  who asked for it
--   pending_requested_at  when
--
-- Approving an edit writes pending_values onto the row (the existing
-- apply_stock_movement_update trigger corrects stock by the difference);
-- approving a delete deletes the row (reverse_stock_movement gives its
-- quantity back). Rejecting clears the request and the movement stays as it
-- was. Pending (never approved) movements are still edited or deleted
-- directly — they haven't touched stock yet.
--
-- Running this adds four nullable columns; no existing rows change and no
-- trigger is redefined.

alter table public.stock_movements
  add column if not exists pending_action text,
  add column if not exists pending_values jsonb,
  add column if not exists pending_requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists pending_requested_at timestamptz;

alter table public.stock_movements drop constraint if exists stock_movements_pending_action_check;
alter table public.stock_movements
  add constraint stock_movements_pending_action_check check (pending_action is null or pending_action in ('edit', 'delete'));
