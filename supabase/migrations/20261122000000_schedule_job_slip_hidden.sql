-- An order removed from the Release Slip (its × on the slip page) stays off
-- the slip: schedule_jobs.slip_hidden. The visit itself is unchanged — still
-- in the Daily Report and the Schedule as it was. Set (and cleared, by
-- "Restore") only through /api/release-slip/remove-order, which also takes
-- the order's pending items out of the Inventory List.
--
-- Running this changes no existing rows: it adds one column (false for all).

alter table public.schedule_jobs
  add column if not exists slip_hidden boolean not null default false;
