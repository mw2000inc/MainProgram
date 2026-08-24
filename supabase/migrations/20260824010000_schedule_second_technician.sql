-- Optional second technician on a schedule job (e.g. a pull-out + install
-- combo needing two people). Nullable, additive — every existing single-
-- technician row is unaffected; `technician` stays the required primary field.
alter table public.schedule_jobs
  add column if not exists technician_2 text;
