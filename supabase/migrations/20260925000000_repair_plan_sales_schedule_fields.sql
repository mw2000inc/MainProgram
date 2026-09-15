-- Brings repair_plans the same SalesSchedule-form field set install_plans
-- already has (Contact #, In or Out, Model, Unit price, C/P price, Delivery
-- & Installation Fee, Payment Mode, Receipt #, Pre Installed Date, Installed
-- Date, Sales Person, Via, Note) — the AppSheet Repair Plan form and
-- SalesSchedule form were originally treated as two distinct field sets
-- (see 20260817010000_daily_report_field_expansion.sql's own split between
-- them), but a repair job can also involve selling/installing a
-- replacement unit, so this app's own Repair Plan needs the same fields.
--
-- Distinct from Repair's own existing columns of a similar name:
-- in_out here is the new "IN"/"OUT" concept (matching install_plans.in_out
-- exactly), not the same thing as the already-existing unit_in_out
-- ("In"/"Out", different casing, different column, kept as-is). Both are
-- retained side by side per the explicit decision on this.
--
-- All nullable, no default — matches address's own shape from
-- 20260924000000, since every existing row has none of these values.
alter table public.repair_plans
  add column if not exists contact_number text,
  add column if not exists in_out text,
  add column if not exists model text,
  add column if not exists unit_price numeric(12, 2),
  add column if not exists cp_price numeric(12, 2),
  add column if not exists delivery_installation_fee numeric(12, 2),
  add column if not exists payment_mode text,
  add column if not exists receipt_no text,
  add column if not exists pre_installed_date date,
  add column if not exists installed_date date,
  add column if not exists sales_person text,
  add column if not exists via text,
  add column if not exists note text;
