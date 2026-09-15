-- Adds a static "2nd Hand" stock balance column to products, alongside the
-- other AppSheet Stock Balances columns added in
-- 20260920000000_product_stock_balance_fields.sql (P_Balance/In Stock/Out
-- Stock/Balance/Brand New). Distinct from inventory-columns.tsx's own
-- computed ProductRow.secondHandReadyQuantity/secondHandRepairQuantity
-- (live, date-scoped values derived from stock_movements) — this is a
-- plain, form-editable count with no relation to that feature.
alter table public.products
  add column if not exists second_hand integer not null default 0;
