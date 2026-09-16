-- Adds S/C as its own directly-entered field on repair_plans — a plain
-- text field an admin types in manually, same as model/problem/
-- solution_status. NOT pulled or joined from sale_list_entries.sc (a
-- different table's own field of the same name, for a different purpose) —
-- confirmed via direct investigation that repair_plans never had an S/C
-- concept before this, unlike model (added in
-- 20260925000000_repair_plan_sales_schedule_fields.sql), which already
-- existed but simply wasn't surfaced in the UI yet.
--
-- Nullable, no default, no backfill — every existing row (in practice, only
-- test data at the time of this migration) has none of this value; admins
-- fill it in going forward as they log new repairs, same shape as model's
-- own original migration.
alter table public.repair_plans
  add column if not exists sc text;
