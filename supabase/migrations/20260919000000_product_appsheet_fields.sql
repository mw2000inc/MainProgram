-- Brings public.products a step closer to the old AppSheet Inventory
-- sheet's own column set: a separate Description, distinct from the
-- combined Item name already stored in `name`.
--
-- Deliberately NOT adding P_Balance/In Stock/Out Stock/Balance/Brand New
-- here even though those are also real AppSheet column names — those are
-- already a fully-built feature on the /inventory list page
-- (inventory-columns.tsx's own ProductRow.pBalance/inStockOnDate/
-- outStockOnDate/balance/brandNewQuantity), computed live and date-scoped
-- from stock_movements, never stored on the product itself. Adding static,
-- manually-typed columns of the same name here would just create a second,
-- conflicting "Balance" number under an identical label rather than
-- supporting anything.
alter table public.products
  add column if not exists description text;
