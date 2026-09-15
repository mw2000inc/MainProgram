-- The Add/Edit Product form no longer collects a Supplier (removed from
-- product-form-dialog.tsx alongside the AppSheet Stock Balances rework), so
-- every new product submission would otherwise fail this NOT NULL
-- constraint outright. The FK to suppliers itself stays — a null
-- supplier_id just means "no supplier set", the same optional-FK shape
-- barcode/description already have on this table.
alter table public.products
  alter column supplier_id drop not null;
