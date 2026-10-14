-- Every technician assigned to a schedule job, as one list of logins.
--
-- A job holds up to two technicians: technician / technician_2 (names) and
-- technician_user_id / technician_2_user_id (their logins) — one job, shown on
-- BOTH technicians' Daily Reports and agendas (schedule_jobs_select RLS lets
-- either login read it), never a duplicate job per technician. Admins asked
-- (2026-10-14) for the assigned team as a single list on the job too.
--
-- technician_user_ids is generated from those two columns, so it can never
-- drift from them: every existing save path (forms, inline edits, the record
-- → job sync, approvals) keeps working unchanged, and the list updates by
-- itself. Read-only — write the two technician columns as before. Unassigned
-- slots are left out (an empty list when nobody is assigned).

alter table public.schedule_jobs
  add column if not exists technician_user_ids uuid[]
  generated always as (
    array_remove(array[technician_user_id, technician_2_user_id], null)
  ) stored;

create index if not exists schedule_jobs_technician_user_ids_idx
  on public.schedule_jobs using gin (technician_user_ids);
