-- Smart Automatic Scheduling System -- schema piece only. Three small,
-- additive columns, all nullable, all following the exact shape of
-- something this app already has -- no new architecture introduced.
--
-- =========================================================================
-- 1. schedule_jobs.latitude / longitude / location_source
--
-- The clustering/technician-assignment logic (implemented in
-- src/lib/scheduling/smart-schedule.ts, run from the API routes that call
-- respond_to_dispatch_confirmation/accept_requested_reschedule -- Postgres
-- itself has no outbound-HTTP path to Nominatim, see
-- dispatch_dual_channel_notifications's own comment on why anything that
-- needs a real HTTP call has to live in a route, not a trigger/RPC) needs
-- to compare "this new job" against every other technician's jobs already
-- on the same day. Without a location cached directly on schedule_jobs,
-- every one of those comparisons would mean re-resolving the *other* jobs'
-- locations too -- a different join for each of the four job types
-- (customers, install_plans, repair via sale_list_entries...). Caching the
-- resolved point directly on the row that's actually being compared avoids
-- that entirely, and mirrors the same "resolve once, cache" pattern already
-- used for customers.latitude/longitude.
--
-- location_source records *how* that point was obtained, purely for
-- transparency (the report/UI can say why a job landed where it did,
-- instead of a bare number nobody can explain):
--   customer_cached    - reused customers.latitude/longitude, already there
--   customer_geocoded  - customers had no coordinates yet; geocoded the
--                        customer's address via the existing Nominatim
--                        integration and cached it back onto customers too
--   install_geocoded   - install_plans has no customer_id to borrow
--                        coordinates from; its own address was geocoded
--                        (and cached on install_plans itself, see below)
--   repair_via_customer - repair_plans has neither customer_id nor address;
--                        resolved via order_no -> sale_list_entries ->
--                        customers, then customer_cached/customer_geocoded
--                        rules applied from there
--   unavailable        - none of the above worked; the job is left
--                        unassigned for admin review rather than guessed
alter table public.schedule_jobs
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_source text
    check (location_source in ('customer_cached', 'customer_geocoded', 'install_geocoded', 'repair_via_customer', 'unavailable'));

-- =========================================================================
-- 2. schedule_jobs.route_sequence
--
-- Requested explicitly: a lightweight ordering field for "which stop is
-- this in the technician's day", distinct from scheduled_time (free text,
-- e.g. "MORNING"/"ANYTIME" -- see schedule_time_and_secondary_address's own
-- comment on why it was never meant to be a sortable/strict time field, so
-- it can't double as a route position either).
--
-- Left as a plain integer with gaps (new auto-assigned stops get
-- +-10 relative to a technician's existing extreme stop for that day, see
-- smart-schedule.ts) rather than a dense 1..N sequence, specifically so
-- inserting a new stop never requires renumbering any other technician's
-- already-set rows -- an admin-confirmed schedule's route_sequence is never
-- touched by a later automatic assignment. Nullable: most existing rows
-- (anything created before this feature, or any job the automation
-- couldn't place) simply have no route position, which the UI treats as
-- "unordered" rather than "first".
alter table public.schedule_jobs
  add column if not exists route_sequence integer;

-- =========================================================================
-- 3. install_plans.latitude / longitude
--
-- install_plans has an address but no customer_id (a pre-existing gap,
-- confirmed in auto_create_schedule_job_on_confirm's own comment) -- there
-- is no customer row to cache resolved coordinates on the way
-- customers.latitude/longitude already does. Same shape, same nullable
-- "cache once, reuse after" intent as that column, just living on the one
-- table that actually owns this address when there's no customer to borrow
-- coordinates from.
alter table public.install_plans
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

comment on column public.schedule_jobs.location_source is
  'How latitude/longitude on this row were obtained -- see the smart_schedule_assignment_columns migration for the full explanation of each value.';
