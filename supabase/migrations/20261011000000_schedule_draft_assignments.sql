-- Draft Assignments (Schedule page): a new staging table for the
-- "auto-cluster pending Filter Change/Collection/Repair work for a date,
-- let an admin review/edit, then approve" workflow. Deliberately NOT the
-- existing dispatch_status ('Draft'/'Pending Customer Confirmation'/
-- 'Confirmed'/'Reschedule Requested') on the four plan tables — that
-- enum already means something else entirely (customer confirmation of a
-- scheduled date, see 20260830160000_dispatch_confirmation_workflow.sql)
-- and is completely orthogonal to technician assignment. A brand-new table
-- keeps this feature from touching that workflow's check constraints or
-- semantics at all.
--
-- One row per pending plan record included in a "Generate" run for a given
-- date — entity_type/entity_id mirror the app's existing DispatchEntityType
-- convention (smart-schedule.ts) for "which of the plan tables." Approving
-- writes proposed_technician/proposed_technician_2 onto that row's own
-- table (serviceman/serviceman_2, or th/th_2 for repair_plans) and deletes
-- the draft row — there is no separate "approved" status to track here,
-- since an approved draft's job is already done once real data reflects it.
-- install_plans is deliberately excluded: this feature was scoped to
-- Filter Change/Collection/Repair only.
create table public.schedule_draft_assignments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('filter_change_plans', 'collections', 'repair_plans')),
  entity_id uuid not null,
  target_date date not null,
  proposed_technician text not null default '',
  proposed_technician_2 text not null default '',
  distance_km numeric,
  nearby_count integer not null default 0,
  explanation text not null default '',
  outside_coverage boolean not null default false,
  created_at timestamptz not null default now(),
  -- Re-generating for the same date replaces (upserts) this same row rather
  -- than piling up duplicates for the same underlying record.
  unique (entity_type, entity_id)
);

alter table public.schedule_draft_assignments enable row level security;

-- Only admins ever see or manage this queue — same restriction every other
-- assignment/approval surface in this app already has. Insert/update are
-- deliberately NOT granted to the authenticated role at all: those only
-- ever happen via the service-role client in the generate/approve API
-- routes (same posture as applyTechnicianAssignmentsToJobs), which bypasses
-- RLS entirely, so no insert/update policy is needed here.
create policy "schedule_draft_assignments_admin_select" on public.schedule_draft_assignments
  for select to authenticated using (public.is_admin());
create policy "schedule_draft_assignments_admin_delete" on public.schedule_draft_assignments
  for delete to authenticated using (public.is_admin());
