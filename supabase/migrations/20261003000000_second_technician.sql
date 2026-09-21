-- A second technician on every plan-level technician field.
--
-- Up to two technicians can now be assigned wherever one could before.
-- schedule_jobs already has this (technician + technician_2, from
-- 20260824010000_schedule_second_technician.sql), so it isn't touched here;
-- this adds the matching second column to the five places that only had one:
--
--   filter_change_plans.serviceman  -> serviceman_2
--   collections.serviceman          -> serviceman_2
--   install_plans.serviceman        -> serviceman_2
--   repair_plans.th                 -> th_2   (th's own naming convention)
--   customers.assigned_technician   -> assigned_technician_2
--
-- Same shape as the primary columns: plain text, not null, default '' (blank
-- means "no second technician"). Free text on purpose — the primary columns
-- were never constrained to the TECHNICIANS roster either.
--
-- Deliberately additive only. The job-completion trigger
-- (handle_schedule_job_filter_item) still copies just the job's PRIMARY
-- technician onto the filter-change row it creates; it isn't replaced here
-- because that function also deducts stock, and a bad copy of it could break
-- job completion for a purely cosmetic gain.
--
-- Run this BEFORE deploying the app version that reads/writes these columns:
-- the filter-change job generator selects assigned_technician_2 by name, so it
-- would error against a database that doesn't have the column yet.

alter table public.filter_change_plans
  add column if not exists serviceman_2 text not null default '';

alter table public.collections
  add column if not exists serviceman_2 text not null default '';

alter table public.install_plans
  add column if not exists serviceman_2 text not null default '';

alter table public.repair_plans
  add column if not exists th_2 text not null default '';

alter table public.customers
  add column if not exists assigned_technician_2 text not null default '';
