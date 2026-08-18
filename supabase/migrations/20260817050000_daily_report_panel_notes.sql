-- One shared, admin-editable free-text note per Daily Report panel (not
-- per-date) — Announcements, Schedule, Filter Change Plan, Installation Plan,
-- Repair Plan, Collection Plan. Everyone reads; only admins write, via the
-- existing is_admin() RLS pattern.
create table public.daily_report_panel_notes (
  panel_id text primary key,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.daily_report_panel_notes (panel_id) values
  ('announcements'),
  ('schedule'),
  ('filter-change'),
  ('installation'),
  ('repair'),
  ('collection');

alter table public.daily_report_panel_notes enable row level security;

create policy "daily_report_panel_notes_select" on public.daily_report_panel_notes for select to authenticated using (true);
create policy "daily_report_panel_notes_insert_admin" on public.daily_report_panel_notes for insert to authenticated with check (public.is_admin());
create policy "daily_report_panel_notes_update_admin" on public.daily_report_panel_notes for update to authenticated using (public.is_admin());
