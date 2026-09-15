-- Brings install_plans a step closer to AppSheet's own SalesSchedule form
-- field set: Payment Mode, Receipt #, Sales Person, and Via — genuinely
-- missing columns, not something this app already tracks anywhere else.
-- All nullable with no default, matching note/model_dp's own
-- optional-string shape, since every existing row has none of these values.
alter table public.install_plans
  add column if not exists payment_mode text,
  add column if not exists receipt_no text,
  add column if not exists sales_person text,
  add column if not exists via text;
