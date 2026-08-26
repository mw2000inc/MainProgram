-- Closes two gaps found in the Technician role's actual behavior:
--
-- 1. filter_change_plans / install_plans / repair_plans / collections still
--    had their original `with check (true)` / `using (true)` insert+update
--    policies from before the Technician role existed (see
--    20260817000000_dashboard_daily_report.sql) — any authenticated user,
--    Technician included, could create or edit rows via the anon-key
--    browser client regardless of what the UI showed. The UI bug (a
--    Technician seeing "+ Add" on these panels) has a matching frontend fix
--    alongside this migration, but per this app's established model the
--    browser only ever talks to Supabase with the anon key, so RLS is the
--    real boundary — hiding the button alone would not have been enough.
--    SELECT stays open to every authenticated user, matching the existing
--    agreement that these tables are Daily Report's own self-contained,
--    fully-readable-by-Technician data. DELETE was already admin-only on
--    all four tables and is unchanged.
--
-- 2. schedule_jobs only had technician_user_id (single account link), but a
--    job can have two named technicians (technician / technician2). Without
--    a second account link, only the account listed in technician_user_id
--    could ever see a shared two-technician job — the other technician's
--    account had no way to match the row. Adds technician_2_user_id,
--    nullable and additive (same pattern as technician_user_id itself:
--    purely for RLS scoping, not the display/print/export source of truth,
--    which stays the technician/technician2 text fields), and widens
--    schedule_jobs_select so either linked account can read the row. This
--    does not create a second schedule_jobs row for the second technician —
--    both accounts read the exact same row, so scheduled_date/status/etc.
--    can never diverge between them.

drop policy if exists "filter_change_plans_write" on public.filter_change_plans;
create policy "filter_change_plans_write_admin" on public.filter_change_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "filter_change_plans_update" on public.filter_change_plans;
create policy "filter_change_plans_update_admin" on public.filter_change_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "install_plans_write" on public.install_plans;
create policy "install_plans_write_admin" on public.install_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "install_plans_update" on public.install_plans;
create policy "install_plans_update_admin" on public.install_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "repair_plans_write" on public.repair_plans;
create policy "repair_plans_write_admin" on public.repair_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "repair_plans_update" on public.repair_plans;
create policy "repair_plans_update_admin" on public.repair_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "collections_write" on public.collections;
create policy "collections_write_admin" on public.collections
  for insert to authenticated with check (public.is_admin());

drop policy if exists "collections_update" on public.collections;
create policy "collections_update_admin" on public.collections
  for update to authenticated using (public.is_admin());

alter table public.schedule_jobs
  add column technician_2_user_id uuid references public.profiles(id) on delete set null;

drop policy if exists "schedule_jobs_select" on public.schedule_jobs;
create policy "schedule_jobs_select" on public.schedule_jobs for select to authenticated
  using (public.is_admin() or technician_user_id = auth.uid() or technician_2_user_id = auth.uid());
