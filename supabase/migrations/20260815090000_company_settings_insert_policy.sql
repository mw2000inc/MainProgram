-- company_settings is a singleton (id = 1) seeded by the init migration. A data
-- wipe (e.g. TRUNCATE) can remove that row, after which the Settings save — which
-- runs under RLS via the browser client — had no way to recreate it: there was a
-- SELECT and an UPDATE policy but no INSERT policy, so an upsert's insert path was
-- denied and the save failed. Add an admin-only INSERT policy so upsert can heal
-- the missing row, and re-seed defensively in case it's already gone.

create policy "company_settings_insert_admin" on public.company_settings
  for insert to authenticated with check (public.is_admin());

-- Self-heal: recreate the singleton with schema defaults if it's missing.
-- Idempotent — leaves an existing row (and its real values) untouched.
insert into public.company_settings (id) values (1)
on conflict (id) do nothing;
