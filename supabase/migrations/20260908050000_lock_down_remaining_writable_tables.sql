-- Security audit finding: seven tables have carried their original,
-- fully-permissive `with check (true)` / `using (true)` insert/update
-- policies (from the very first schema) the whole time, meaning ANY
-- authenticated user -- a technician account included -- can currently
-- create or modify rows in them directly via the anon-key REST API,
-- completely bypassing the app's own stated design: "A technician's scope
-- is Daily Report only, nothing else -- every other module is admin-only
-- in practice (RLS blocks the underlying data too)" (see nav-items.ts's
-- own comment). The UI already hides these pages/forms from a technician;
-- that was never the real boundary (this app talks to Supabase with the
-- anon key, so RLS is the only actual enforcement -- see
-- schedule_jobs_admin_only_write's own comment on this exact point).
--
-- This is the SAME bug, on different tables, as the one
-- reassert_plan_tables_admin_write already found and fixed once for
-- filter_change_plans/install_plans/repair_plans/collections (confirmed
-- live back then: "a technician account could still freely INSERT/UPDATE
-- all four tables via the anon-key REST API"). DELETE was already
-- correctly admin-gated on every one of the seven tables below the whole
-- time -- only INSERT/UPDATE were ever missed for these specific tables
-- (products/suppliers/stock_movements/activity_logs never had this gap at
-- all, and the four plan tables already got their own fix).
--
-- Checked every current call site of a create/update hook for each of
-- these tables before writing this (useCreateCustomer/useUpdateCustomer,
-- useCreateSaleListEntry/useUpdateSaleListEntry) -- every one of them is
-- reached only from an already admin-gated surface (the Member/Sale List
-- pages, the Install form's auto-create-a-member flow, and
-- DispatchApprovalQueue's own contact-correction save), so this changes
-- nothing for how the app actually behaves for an admin; it only closes
-- the gap for a non-admin bypassing the UI. sales/contracts/sale_items/
-- sale_services aren't referenced by any current application code at all
-- (superseded by sale_list_entries and the plan tables) -- this is a
-- hardening fix for them, not a fix for an actively-used path.
drop policy if exists "customers_write" on public.customers;
create policy "customers_write_admin" on public.customers
  for insert to authenticated with check (public.is_admin());
drop policy if exists "customers_update" on public.customers;
create policy "customers_update_admin" on public.customers
  for update to authenticated using (public.is_admin());

drop policy if exists "sale_list_entries_write" on public.sale_list_entries;
create policy "sale_list_entries_write_admin" on public.sale_list_entries
  for insert to authenticated with check (public.is_admin());
drop policy if exists "sale_list_entries_update" on public.sale_list_entries;
create policy "sale_list_entries_update_admin" on public.sale_list_entries
  for update to authenticated using (public.is_admin());

drop policy if exists "contracts_write" on public.contracts;
create policy "contracts_write_admin" on public.contracts
  for insert to authenticated with check (public.is_admin());

drop policy if exists "sales_write" on public.sales;
create policy "sales_write_admin" on public.sales
  for insert to authenticated with check (public.is_admin());

drop policy if exists "sale_items_write" on public.sale_items;
create policy "sale_items_write_admin" on public.sale_items
  for insert to authenticated with check (public.is_admin());

drop policy if exists "sale_services_write" on public.sale_services;
create policy "sale_services_write_admin" on public.sale_services
  for insert to authenticated with check (public.is_admin());

-- notifications has no user_id column at all (a shared/global list, not
-- per-user -- see its own create table statement), so there's no "own
-- notification" concept to preserve here the way profiles_update_self_or_admin
-- does for profiles; admin-only is the correct full fix, not a narrower
-- ownership check.
drop policy if exists "notifications_update" on public.notifications;
create policy "notifications_update_admin" on public.notifications
  for update to authenticated using (public.is_admin());
