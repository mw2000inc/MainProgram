-- OPTIONAL one-time back-fill — run AFTER 20261101000000. It changes data.
--
-- The older installs that already have an Installed Date but are still
-- marked Pending (brought over that way) become Completed; the trigger from
-- 20261101000000 then gives each a completed Installation job on its
-- Installed Date, linked to it.
--
-- Checked live before writing (Oct 10, 2026): 19 installs match, installed
-- 2024-01-05 to 2026-09-22, all dispatch-Confirmed, none with a job. Left
-- out on purpose: the "TEST" install (001-1500, Draft, entered today).
-- Only the status changes, so the install stock queue (model/date/order
-- changes) is not touched. Safe to re-run: a completed row no longer matches.

update public.install_plans
set status = 'Completed'
where status = 'Pending'
  and installed_date is not null
  and installed_date < date '2026-10-10'
  and dispatch_status = 'Confirmed'
  and schedule_job_id is null;
