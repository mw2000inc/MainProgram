-- The filters a technician should bring to a schedule job, as the same
-- comma-separated codes Filter Change uses ("011, 012, 013"). Set from the
-- Auto-suggest modal's Confirm & Assign (per job, and on custom errands) and
-- shown on the Daily Report so the technician knows what to bring.
--
-- Why a column on the job rather than only filter_change_plans.filter_type:
-- checked live, all 26 currently-unassigned schedule jobs (created by the
-- generateFilterChangeJobs automation) have no linked Filter Change visit
-- (no filter_change_plans row points at them through schedule_job_id), so
-- there was nowhere to store their filters. When a job IS linked to a
-- visit, Confirm & Assign writes the same codes to that visit's own Filter
-- too, so the two stay in step.
--
-- Not the same thing as schedule_job_filter_items: those record the filters
-- actually used when a job is completed, and inserting one creates Filter
-- Change/Collection records and a stock movement. This is only the plan.
--
-- Technicians still can't change it: restrict_schedule_job_technician_update()
-- compares the whole row minus status/remarks, so a new column is covered
-- automatically.

alter table public.schedule_jobs
  add column if not exists filter_codes text not null default '';

-- Jobs already linked to a Filter Change visit start with that visit's
-- Filter (checked live: 1 such job today).
update public.schedule_jobs j
set filter_codes = p.filter_type
from public.filter_change_plans p
where p.schedule_job_id = j.id
  and j.filter_codes = ''
  and coalesce(p.filter_type, '') <> '';
