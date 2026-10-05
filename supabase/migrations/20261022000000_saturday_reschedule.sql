-- =========================================================================
-- "Rescheduled from Saturday" marker.
--
-- The Schedule's "Cancel & Auto-Distribute Saturday Queue" moves a Saturday's
-- open jobs and unscheduled visits to the following Monday–Wednesday,
-- grouped by area. rescheduled_from records the Saturday each one came from,
-- so the Schedule can badge it ("Rescheduled from Sat, Oct 10"). Null for
-- everything else. Nothing reads or writes it automatically.
-- =========================================================================

alter table public.schedule_jobs add column if not exists rescheduled_from date;
alter table public.filter_change_plans add column if not exists rescheduled_from date;
alter table public.install_plans add column if not exists rescheduled_from date;
alter table public.repair_plans add column if not exists rescheduled_from date;
alter table public.collections add column if not exists rescheduled_from date;
