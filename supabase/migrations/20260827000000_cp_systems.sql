-- "CP System" — the AppSheet "MW CP > CP System" reference table: a catalog
-- of system codes (UF71, RO71, etc.) and the filter components each one is
-- built from. Stored as a structured jsonb array (name + interval in months
-- per component) rather than one free-text description like the AppSheet
-- original, so a future scheduling feature can compute a due date per
-- component instead of just displaying a paragraph. This migration only
-- adds the catalog + a link column on sale_list_entries — it does not wire
-- either into the existing filter-change due-date/cron logic, which still
-- runs on customers.dispenser_type + company_settings.monitoring_intervals
-- exactly as before.
create table public.cp_systems (
  id uuid primary key default gen_random_uuid(),
  system_code text not null unique,
  -- [{ "name": "MW) Sediment", "intervalMonths": 3 }, ...]
  components jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.cp_systems enable row level security;

-- Same permission shape as other admin-managed catalogs (e.g. products) —
-- every authenticated user can read it, only admins can write.
create policy "cp_systems_select" on public.cp_systems for select to authenticated using (true);
create policy "cp_systems_insert_admin" on public.cp_systems for insert to authenticated with check (public.is_admin());
create policy "cp_systems_update_admin" on public.cp_systems for update to authenticated using (public.is_admin());
create policy "cp_systems_delete_admin" on public.cp_systems for delete to authenticated using (public.is_admin());

-- Links a sale-list order to the CP System actually installed for it. Lives
-- here rather than on customers since "what system is installed" is already
-- tracked per-order (product_no) at this granularity, and one customer can
-- have multiple orders/installs with different systems.
alter table public.sale_list_entries
  add column cp_system_id uuid references public.cp_systems(id) on delete set null;
