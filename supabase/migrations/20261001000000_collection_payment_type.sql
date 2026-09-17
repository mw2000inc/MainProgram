-- Payment Type on Collections — GCash/Card/Bank/Cash/Check presets, but
-- freely typable (see the Combobox on the Add/Edit form), same nullable
-- free-text convention as InstallPlan/RepairPlan's own payment_mode column.
alter table public.collections
  add column if not exists payment_type text;
