-- Replaces the "staff" role with "technician" — a much narrower role (see
-- the new schedule_jobs_select policy and RLS locks below) than staff ever
-- had, not a relabel. Renaming the enum VALUE (not dropping/recreating the
-- type) converts every existing 'staff' row to 'technician' automatically,
-- with no data migration needed and no restriction on using the new label
-- later in this same migration (that restriction only applies to ALTER
-- TYPE ... ADD VALUE, not RENAME VALUE).
alter type public.app_role rename value 'staff' to 'technician';

-- handle_new_user() now reads role from raw_app_meta_data, not
-- raw_user_meta_data, and defaults to 'admin' rather than 'technician'.
-- This closes a real hole in the original version: raw_user_meta_data is
-- populated from options.data on the PUBLIC, anon-key auth.signUp() call —
-- meaning anyone could open devtools and call
--   supabase.auth.signUp({ email, password, options: { data: { role: "technician" } } })
-- directly, bypassing the login page's form entirely, and the old trigger
-- would have trusted it. app_metadata has no such path: the public signUp()
-- method's TypeScript type (SignUpWithPasswordCredentials, @supabase/auth-js)
-- exposes only `data` (-> user_metadata) — there is no app_metadata
-- parameter on it at all. app_metadata can only be set via the privileged,
-- service-role Admin API (admin.auth.admin.createUser(), called exclusively
-- from src/app/api/admin/users/route.ts after that route has already
-- confirmed the caller is an admin) or by Supabase itself for OAuth
-- provider identity data (which never includes a "role" key). So with this
-- change: public email/password self-signup and Google self-signup both
-- fall through to the 'admin' default (name still comes from
-- raw_user_meta_data — that part is unaffected and not security-sensitive);
-- only an admin creating a user through the Users page can produce a
-- 'technician' profile, since only that path ever sets app_metadata.role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.email,
    coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'admin')
  );
  return new;
end;
$$;

-- Links a schedule job to the real technician account it's for — nullable
-- and admin-set (via a new selector on the Schedule job form), since none
-- of the technicians named in the existing free-text technician/technician2
-- fields have accounts yet. Deliberately additive: technician/technician2
-- stay exactly as they are (every existing display/print/export/cron site
-- keeps working unchanged) — this column only drives the new "my schedule"
-- scoping below.
alter table public.schedule_jobs
  add column technician_user_id uuid references public.profiles(id) on delete set null;

-- A technician now sees only jobs explicitly linked to their own account —
-- previously any authenticated user (admin or not) could read every row.
-- Jobs with no technician_user_id set are invisible to every technician
-- until an admin links them; this is expected on rollout, not a bug, since
-- no technician account existed before this migration to link anything to.
drop policy if exists "schedule_jobs_select" on public.schedule_jobs;
create policy "schedule_jobs_select" on public.schedule_jobs for select to authenticated
  using (public.is_admin() or technician_user_id = auth.uid());

-- Technician scope is "Daily Report + their own Schedule, nothing else" —
-- closes off every other module's data at the RLS layer (not just hiding
-- pages/nav links), matching this app's existing security model: the
-- browser talks to Supabase with the anon key, so RLS is the only real
-- enforcement boundary (see 20260824020000_schedule_jobs_admin_only_write's
-- own comment). Daily Report's own panel tables (filter_change_plans,
-- install_plans, repair_plans, collections, announcements) are deliberately
-- left open — they're self-contained (denormalized account/contact fields,
-- no join to these tables) and stay fully visible per the agreed scope.
drop policy if exists "customers_select" on public.customers;
create policy "customers_select" on public.customers for select to authenticated using (public.is_admin());

drop policy if exists "sale_list_entries_select" on public.sale_list_entries;
create policy "sale_list_entries_select" on public.sale_list_entries for select to authenticated using (public.is_admin());

drop policy if exists "products_select" on public.products;
create policy "products_select" on public.products for select to authenticated using (public.is_admin());

drop policy if exists "suppliers_select" on public.suppliers;
create policy "suppliers_select" on public.suppliers for select to authenticated using (public.is_admin());

drop policy if exists "sales_select" on public.sales;
create policy "sales_select" on public.sales for select to authenticated using (public.is_admin());

drop policy if exists "sale_items_select" on public.sale_items;
create policy "sale_items_select" on public.sale_items for select to authenticated using (public.is_admin());

drop policy if exists "stock_movements_select" on public.stock_movements;
create policy "stock_movements_select" on public.stock_movements for select to authenticated using (public.is_admin());

drop policy if exists "cp_systems_select" on public.cp_systems;
create policy "cp_systems_select" on public.cp_systems for select to authenticated using (public.is_admin());
