-- Adds the AppSheet "Stock Balances" columns as real, form-editable fields
-- on products: P_Balance, In Stock, Out Stock, Balance, Brand New. Confirmed
-- via a real AppSheet detail-view screenshot (SKU 011: Category "MW",
-- P_Balance 266, In Stock 0, Out Stock 0, Balance 266, Brand New 266) that
-- these are genuine static per-product values, not something this app
-- already computes elsewhere.
--
-- Deliberately new columns rather than reusing stock_quantity/min_stock_level/
-- purchase_price/selling_price — those are real, trigger-maintained
-- operational fields (stock_quantity is kept in sync with stock_movements by
-- a DB trigger, and both stock_quantity/min_stock_level feed the low-stock/
-- out-of-stock indicators via getStockStatus). Repurposing them here would
-- silently break that.
--
-- Also deliberately distinct from inventory-columns.tsx's own
-- ProductRow.pBalance/inStockOnDate/outStockOnDate/balance/brandNewQuantity
-- (live, date-scoped values computed from the stock_movements ledger for the
-- /inventory list page's "In & Out Summary"). Verified the /inventory page's
-- own row-builder (src/app/(app)/inventory/page.tsx) spreads the raw product
-- FIRST and only then assigns its own computed pBalance/balance on top, so
-- these stored columns can never leak into or conflict with that already-
-- working computed feature — they're only ever read directly by the
-- Add/Edit Product form itself.
alter table public.products
  add column if not exists p_balance integer not null default 0,
  add column if not exists in_stock integer not null default 0,
  add column if not exists out_stock integer not null default 0,
  add column if not exists balance integer not null default 0,
  add column if not exists brand_new integer not null default 0;
