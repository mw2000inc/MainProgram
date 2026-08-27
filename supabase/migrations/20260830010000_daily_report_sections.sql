-- Admin-configurable Daily Report sections — a single shared table (not a
-- per-user one like daily_report_layouts) so an admin's changes here apply
-- to every viewer, including technicians, who can only ever read it.
--
-- This is deliberately NOT a generic "add any custom section" system: the
-- six section_keys below are fixed, each backed by its own existing table
-- (schedule_jobs, announcements, install_plans, filter_change_plans,
-- collections, repair_plans) with genuinely different columns — there is no
-- shared "activity" table to bind a new section to, and inventing one was
-- explicitly out of scope. "Add/remove a section" is implemented as
-- enabling/disabling one of these six, not creating new ones; every row
-- always exists, `enabled` is the on/off switch.
create type public.daily_report_section_key as enum (
  'schedule', 'announcements', 'installation', 'filter_change', 'collection', 'repair'
);

create table public.daily_report_sections (
  section_key public.daily_report_section_key primary key,
  label text not null,
  enabled boolean not null default true,
  display_order integer not null,
  -- Which columns of that section's existing table to show in the Daily
  -- Report view — empty means "show all" (the current behavior, unchanged
  -- until an admin actually edits a section). Schedule/Announcements aren't
  -- column-table panels, so this stays '[]' for them; the frontend only
  -- offers a Visible Fields checklist for the four plan sections.
  visible_fields jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.daily_report_sections enable row level security;

-- Every authenticated user (including a technician) needs to read this to
-- know what their own Daily Report should show; only an admin can change it
-- — same is_admin() pattern used everywhere else in this app.
create policy "daily_report_sections_select" on public.daily_report_sections
  for select to authenticated using (true);
create policy "daily_report_sections_insert_admin" on public.daily_report_sections
  for insert to authenticated with check (public.is_admin());
create policy "daily_report_sections_update_admin" on public.daily_report_sections
  for update to authenticated using (public.is_admin());
create policy "daily_report_sections_delete_admin" on public.daily_report_sections
  for delete to authenticated using (public.is_admin());

insert into public.daily_report_sections (section_key, label, enabled, display_order) values
  ('schedule', 'Schedule', true, 1),
  ('announcements', 'Announcement', true, 2),
  ('installation', 'Installation', true, 3),
  ('filter_change', 'Filter Change', true, 4),
  ('collection', 'Collection', true, 5),
  ('repair', 'Repair', true, 6);
