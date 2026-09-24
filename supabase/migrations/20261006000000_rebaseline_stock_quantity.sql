-- Re-baselines products.stock_quantity to: the imported static "Brand New"
-- balance + the net of every APPROVED stock movement.
--
-- Why: stock_quantity is maintained by triggers purely from stock_movements,
-- so it has always started from 0 — it never included the AppSheet Stock
-- Balances imported into products.brand_new. The /inventory table therefore
-- had two disagreeing sources: the static columns (for a product with no
-- movements) and stock_quantity + ledger (as soon as it had one), and the
-- first movement made a product's figures jump from e.g. 265 to -10. With
-- the baseline folded into stock_quantity, the table reads stock_quantity
-- directly and there is one source of truth.
--
-- Only 'approved' rows count: pending and rejected movements have no stock
-- effect (apply_stock_movement() / apply_stock_movement_approval() only act
-- on approved), so they must not be in the sum either.
--
-- Recomputed from source rather than incremented, so re-running is a no-op
-- — provided nobody has edited a product's Brand New since. From here on the
-- existing triggers keep stock_quantity in step with each approved movement,
-- so do not re-run this after changing Brand New values.
--
-- Only rows whose value actually changes are updated, to avoid touching
-- (and audit-logging) every product.
with target as (
  select
    p.id,
    (
      p.brand_new
      + coalesce(sum(m.quantity_added - m.quantity_removed) filter (where m.status = 'approved'), 0)
    )::integer as qty
  from public.products p
  left join public.stock_movements m on m.product_id = p.id
  group by p.id, p.brand_new
)
update public.products p
set stock_quantity = t.qty
from target t
where p.id = t.id
  and p.stock_quantity is distinct from t.qty;
