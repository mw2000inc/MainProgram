-- Admin-customized, shared panel sizes for the Daily Report page — same storage
-- pattern as daily_report_layout (lives on the single company_settings row, so
-- the existing RLS — everyone reads, only admins update — already enforces
-- "only admins can resize, everyone sees the saved size").
alter table public.company_settings
  add column daily_report_panel_sizes jsonb not null default '{}'::jsonb;
