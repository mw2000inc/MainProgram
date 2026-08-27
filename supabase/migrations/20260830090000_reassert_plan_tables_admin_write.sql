-- Re-asserts the admin-only insert/update policies for filter_change_plans,
-- install_plans, repair_plans, and collections. These were already written
-- once, in 20260830000000_technician_readonly_daily_report_and_second_link
-- — but live testing of the new Collection Plan recurring-schedule feature
-- (which requires "only an Admin can edit the schedule, enforced at the
-- backend") found a technician account could still freely INSERT/UPDATE all
-- four tables via the anon-key REST API, meaning that migration's policy
-- changes evidently never actually took effect in production (the original,
-- fully-permissive `using (true)` policies from
-- 20260817000000_dashboard_daily_report were still live). This migration
-- doesn't change the intended rule at all — it just re-applies it,
-- idempotently (drop-if-exists then create), so it's safe to run whether or
-- not the original migration ever did.
drop policy if exists "filter_change_plans_write" on public.filter_change_plans;
drop policy if exists "filter_change_plans_write_admin" on public.filter_change_plans;
create policy "filter_change_plans_write_admin" on public.filter_change_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "filter_change_plans_update" on public.filter_change_plans;
drop policy if exists "filter_change_plans_update_admin" on public.filter_change_plans;
create policy "filter_change_plans_update_admin" on public.filter_change_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "install_plans_write" on public.install_plans;
drop policy if exists "install_plans_write_admin" on public.install_plans;
create policy "install_plans_write_admin" on public.install_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "install_plans_update" on public.install_plans;
drop policy if exists "install_plans_update_admin" on public.install_plans;
create policy "install_plans_update_admin" on public.install_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "repair_plans_write" on public.repair_plans;
drop policy if exists "repair_plans_write_admin" on public.repair_plans;
create policy "repair_plans_write_admin" on public.repair_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists "repair_plans_update" on public.repair_plans;
drop policy if exists "repair_plans_update_admin" on public.repair_plans;
create policy "repair_plans_update_admin" on public.repair_plans
  for update to authenticated using (public.is_admin());

drop policy if exists "collections_write" on public.collections;
drop policy if exists "collections_write_admin" on public.collections;
create policy "collections_write_admin" on public.collections
  for insert to authenticated with check (public.is_admin());

drop policy if exists "collections_update" on public.collections;
drop policy if exists "collections_update_admin" on public.collections;
create policy "collections_update_admin" on public.collections
  for update to authenticated using (public.is_admin());
