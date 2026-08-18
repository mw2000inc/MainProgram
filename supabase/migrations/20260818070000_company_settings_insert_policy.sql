-- company_settings is a singleton (id = 1) seeded by the init migration. A data
-- wipe (e.g. TRUNCATE) can remove that row, after which the Settings save — which
-- runs under RLS via the browser client — had no way to recreate it: there was a
-- SELECT and an UPDATE policy but no INSERT policy, so an upsert's insert path was
-- denied and the save failed. Add an admin-only INSERT policy so upsert can heal
-- the missing row, and re-seed defensively in case it's already gone.
--
-- Originally dated 20260815090000, which put it *before* several migrations
-- (20260817000000 onward) that had already been pushed by the time this file
-- was actually written — Supabase's migration tracking expects versions in
-- increasing order, so an out-of-order file like that is silently never
-- picked up by `db push`. Renamed to sort after everything currently applied.
-- `drop policy if exists` makes this safe to run again on a database (like
-- this one) where the policy was already created by hand out-of-band.
drop policy if exists "company_settings_insert_admin" on public.company_settings;
create policy "company_settings_insert_admin" on public.company_settings
  for insert to authenticated with check (public.is_admin());

-- Self-heal: recreate the singleton with schema defaults if it's missing.
-- Idempotent — leaves an existing row (and its real values) untouched.
insert into public.company_settings (id) values (1)
on conflict (id) do nothing;
