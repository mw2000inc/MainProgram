-- Schedule jobs: only admins may create or edit — staff/technicians remain
-- fully read-only. Mirrors the existing products/suppliers/company_settings
-- admin-write pattern (public.is_admin()). DELETE was already admin-only
-- (schedule_jobs_delete_admin); this closes the gap on INSERT/UPDATE, which
-- previously allowed any authenticated user to write via `with check (true)`
-- / `using (true)` — a real hole since the app's schedule API goes through
-- the anon-key browser client, so RLS is the only real enforcement boundary.
drop policy if exists "schedule_jobs_write" on public.schedule_jobs;
create policy "schedule_jobs_write_admin" on public.schedule_jobs
  for insert to authenticated with check (public.is_admin());

drop policy if exists "schedule_jobs_update" on public.schedule_jobs;
create policy "schedule_jobs_update_admin" on public.schedule_jobs
  for update to authenticated using (public.is_admin());
