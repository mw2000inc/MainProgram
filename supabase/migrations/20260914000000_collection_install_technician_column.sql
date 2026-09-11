-- Adds a plan-level technician column to collections and install_plans --
-- the only two of the four dispatch tables without one (filter_change_plans
-- already has `serviceman`, repair_plans already has `th`, both from
-- 20260817010000_daily_report_field_expansion.sql; that same migration's
-- own comment confirms this was a deliberate AppSheet-parity choice at the
-- time, not an oversight -- the old Collection Plan/Install SalesSchedulePlan
-- forms genuinely had no technician field of their own).
--
-- Needed so an admin can assign a technician to a Collection/Installation
-- item in the Pending Approvals dialog BEFORE it's ever sent to the
-- customer -- until now, the only place a technician existed for these two
-- modules was schedule_jobs.technician, which doesn't get created until
-- AFTER the customer confirms (see auto_create_schedule_job_on_confirm),
-- so there was nothing to assign yet at review time.
--
-- Named `serviceman` (not `th`, repair_plans' own name) to match the
-- clearer, more common convention -- `th` predates this and is kept as-is
-- rather than renamed, to avoid an unrelated breaking change to a column
-- name several places in the app already read.
alter table public.collections
  add column serviceman text not null default '';

alter table public.install_plans
  add column serviceman text not null default '';
