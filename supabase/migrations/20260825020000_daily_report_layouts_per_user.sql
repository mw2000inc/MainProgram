-- The Daily Report grid layout (panel order, sizes, stacked/grid mode) used
-- to live on the single shared company_settings row, so every admin
-- overwrote the same layout for everyone. Each admin now gets their own
-- saved layout instead — one row per user, keyed by user_id, readable/
-- writable only by its owner. Staff never read or write this table at all
-- (the app only queries it when the viewer is an admin) — they always see
-- the hardcoded default order/sizes.
create table public.daily_report_layouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  layout jsonb not null default '[]'::jsonb,
  panel_sizes jsonb not null default '{}'::jsonb,
  layout_mode text not null default 'stacked',
  updated_at timestamptz not null default now()
);

alter table public.daily_report_layouts enable row level security;

create policy "daily_report_layouts_select_own" on public.daily_report_layouts
  for select to authenticated using (user_id = auth.uid());
create policy "daily_report_layouts_insert_own" on public.daily_report_layouts
  for insert to authenticated with check (user_id = auth.uid());
create policy "daily_report_layouts_update_own" on public.daily_report_layouts
  for update to authenticated using (user_id = auth.uid());
create policy "daily_report_layouts_delete_own" on public.daily_report_layouts
  for delete to authenticated using (user_id = auth.uid());

-- The old shared-row columns are fully replaced by the table above — drop
-- them rather than leave dead columns behind.
alter table public.company_settings
  drop column if exists daily_report_layout,
  drop column if exists daily_report_panel_sizes,
  drop column if exists daily_report_layout_mode;
