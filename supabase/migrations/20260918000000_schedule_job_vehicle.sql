-- Vehicle/transport method assigned to a schedule_jobs row (e.g.
-- "Motorcycle", "Car", "Van", or a specific plate/unit typed in directly)
-- — plain text rather than an enum, same "not null default ''" convention
-- already used for technician/serviceman columns across this schema, so
-- every existing row simply reads as "unassigned" (empty string) rather
-- than needing a backfill.
alter table public.schedule_jobs
  add column if not exists vehicle text not null default '';
