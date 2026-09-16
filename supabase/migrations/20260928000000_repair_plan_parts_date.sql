-- Adds a per-line-item "entry date" to repair_plan_parts, editable by an
-- admin (e.g. logging a part actually used on an earlier visit, or a
-- follow-up date after the fact) — deliberately its own column, NOT
-- created_at/updated_at, which stay exactly what they've always been here:
-- unspoofable audit-trail timestamps set only by set_audit_columns() from
-- auth.uid()'s own transaction time (see the audit_logging migration). A
-- user-editable "when was this part actually used" date and a tamper-proof
-- "when was this row actually written" audit timestamp are two different
-- facts and must not share one column.
--
-- Defaults to current_date so every existing row (and any future manual
-- insert that doesn't specify one) gets a sensible value; the Add/Edit Part
-- dialog itself defaults new rows to the repair record's own issued date
-- instead (see repair-parts-section.tsx), which is usually the more useful
-- default than "today" for a part being logged after the fact.
alter table public.repair_plan_parts
  add column if not exists part_date date not null default current_date;
