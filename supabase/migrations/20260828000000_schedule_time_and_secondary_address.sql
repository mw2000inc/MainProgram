-- Adds two fields needed by the Schedule page's new Table View:
-- - scheduled_time: free text ("ANYTIME", "MORNING", "2:00 PM", etc.) rather
--   than a strict time type, since that's how these were actually recorded
--   in the old AppSheet source.
-- - secondary_address: an optional second location for the same job (e.g. a
--   pull-out address distinct from the install address) — deliberately a
--   second column on the SAME row rather than a second schedule_jobs row,
--   same reasoning as technician2 (see its comment in src/lib/types/index.ts):
--   one job, one date/status/order, just an extra address to show alongside
--   the first.
alter table public.schedule_jobs
  add column scheduled_time text,
  add column secondary_address text;
