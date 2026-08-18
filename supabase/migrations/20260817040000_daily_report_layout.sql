-- Shared, admin-editable panel order for the Daily Report page. Lives on the
-- single company_settings row (same table already used for other org-wide
-- config) so the existing RLS — everyone reads, only admins update — already
-- gives us exactly "only admins can reorder, everyone sees the saved layout"
-- with no new policies needed.
alter table public.company_settings
  add column daily_report_layout jsonb not null default '[]'::jsonb;
