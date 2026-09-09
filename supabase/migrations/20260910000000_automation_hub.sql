-- Backing store for the new Automation Hub (src/lib/automations/*) --
-- purely additive: two new things, nothing existing touched, no behavior
-- changes for anyone until an admin actually visits the new Settings >
-- Automations panel.
--
-- =========================================================================
-- 1. company_settings.automation_settings -- per-automation on/off
--    overrides, keyed by AutomationId (see src/lib/automations/types.ts),
--    e.g. {"filterChangeInventoryDeduction": false}. A missing key means
--    "use the code-level default in src/lib/automations/config.ts", not
--    "disabled" -- so a brand new automation added later, that no admin has
--    ever touched on this page, defaults to on/off exactly as its own
--    definition says, not silently off just because this column doesn't
--    know about it yet. Reuses the existing singleton settings row/RLS/
--    audit trigger rather than a new table -- this is one more admin-
--    configurable app setting, not a distinct concern.
-- =========================================================================
alter table public.company_settings
  add column if not exists automation_settings jsonb not null default '{}'::jsonb;

-- =========================================================================
-- 2. automation_runs -- the audit trail for every automation execution,
--    scheduled (cron) or manually triggered by an admin from the Settings
--    page. Deliberately its own table rather than reusing activity_logs:
--    that table's whole shape (user_id referencing profiles, populated by
--    reading auth.uid() at the database layer) is built around a real,
--    authenticated human actor and log_audit_event() only ever fires from
--    a row-level trigger on a real data change -- a cron-triggered run that
--    changes zero rows, or fails outright, would have nothing to attach a
--    profiles.id to and no row-level trigger to fire it from. This table
--    has no actor at all by design (every run is the system, not a
--    person) and is written directly by the automation engine itself
--    (server-side, via the service-role client -- see runAutomation()),
--    the same way the existing cron routes already write to their own
--    target tables.
-- =========================================================================
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id text not null,
  -- 'skipped' = the automation is toggled off in company_settings.
  -- automation_settings (or its own code default) -- still logged, so an
  -- admin looking at the history can tell "it didn't run because it's off"
  -- apart from "it ran and found nothing to do" or "it ran and failed".
  status text not null check (status in ('success', 'error', 'skipped')),
  message text,
  detail jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists automation_runs_automation_id_created_at_idx
  on public.automation_runs (automation_id, created_at desc);

alter table public.automation_runs enable row level security;

drop policy if exists "automation_runs_select_admin" on public.automation_runs;
create policy "automation_runs_select_admin" on public.automation_runs
  for select to authenticated using (public.is_admin());

-- Deliberately no insert/update/delete policy for the authenticated role,
-- admin included -- every row is written by the engine itself through the
-- service-role client (bypasses RLS the same way every existing cron route
-- already does), never directly by a browser session. Nobody can edit or
-- fabricate a run entry.
