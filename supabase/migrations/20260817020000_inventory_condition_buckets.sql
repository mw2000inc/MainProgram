-- Splits the single "2nd hand" stock-movement bucket into ready vs needs-repair,
-- and adds a Demo bucket, to match the old AppSheet SKU REF condition breakdown
-- (Brand New / 2nd hand (ready) / 2nd hand (need repair) / Demo).
-- P_Balance / In Stock / Out Stock on the Inventory table are derived at query time
-- from these columns (today's movements vs. the live running balance) — no new
-- column needed for those.

alter table public.stock_movements
  add column second_hand_ready_quantity integer not null default 0,
  add column second_hand_repair_quantity integer not null default 0,
  add column demo_quantity integer not null default 0;

-- Existing second-hand entries had no ready/repair distinction — treat them as "ready".
update public.stock_movements
  set second_hand_ready_quantity = second_hand_quantity;

alter table public.stock_movements
  drop column second_hand_quantity;
