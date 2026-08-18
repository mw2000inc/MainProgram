-- Lets an admin switch the Daily Report page between the existing draggable/
-- resizable stacked column and a fixed 2x2 grid (Filter Change Plan +
-- Installation Plan on top, Repair Plan + Collection Plan below). Shared
-- across every viewer, same storage pattern as daily_report_layout /
-- daily_report_panel_sizes — the existing RLS on company_settings (everyone
-- reads, only admins update) already enforces "only admins can switch modes."
alter table public.company_settings
  add column daily_report_layout_mode text not null default 'stacked'
    check (daily_report_layout_mode in ('stacked', 'grid'));
