-- Phase 0 of app-wide language support (English/Korean) -- adds the
-- per-user, synced locale preference. A real profiles column, not
-- localStorage, since (per the admin's explicit decision) a language choice
-- should follow someone across devices, unlike the sidebar display mode
-- (see sidebar-collapse-context.tsx's own comment on why THAT one is
-- localStorage instead).
--
-- No new RLS policy needed: "profiles_update_self_or_admin" (init_schema)
-- already allows a user to update their own row (id = auth.uid()), and this
-- is just a new column on that same table -- Postgres RLS policies are
-- row-level, not column-level, so the existing UPDATE policy already covers
-- writing this column.
alter table public.profiles
  add column if not exists locale text not null default 'en';

alter table public.profiles
  drop constraint if exists profiles_locale_check;

alter table public.profiles
  add constraint profiles_locale_check check (locale in ('en', 'ko'));
