-- Phase 6 of app-wide language support -- a shared, generic cache for
-- on-demand translations of live user-authored content (Notes fields,
-- Announcement bodies, comment bodies, etc.), reached from
-- /api/translate. One table reused across every Notes-bearing table in
-- the app instead of a bespoke translated-copy column added to each one
-- (customers.notes, filter_change_plans.note, collections.note,
-- repair_plans.problem/solution_status, announcements.body,
-- announcement_comments.body, schedule_jobs.notes/remarks, ...) --
-- keeps this additive and independent of every other table's own schema.
--
-- entity_id is `text`, not `uuid` -- this table has no FK to any of the
-- tables it caches translations for (deliberately: it's a pure
-- side-cache, and the entities it points at span many different tables),
-- so there's no reason to force every caller to pass a uuid literal.
--
-- source_hash lets a stale cache entry be detected cheaply: whenever the
-- original text is edited, its hash changes, so a lookup for the new
-- hash simply misses and the row is re-translated and upserted -- no
-- separate invalidation trigger needed on every source table.
create table if not exists public.content_translations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  field_name text not null,
  locale text not null,
  source_hash text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  constraint content_translations_locale_check check (locale in ('en', 'ko')),
  constraint content_translations_unique unique (entity_type, entity_id, field_name, locale)
);

alter table public.content_translations enable row level security;

-- Broadly readable/writable by any signed-in user (admin or technician)
-- -- a cached translation is never sensitive (it's a derived copy of
-- content the viewer can already see), and re-translating after a source
-- edit is a normal part of this cache's own operation, not a privileged
-- action. Same "to authenticated using (true)" shape already used for
-- plenty of other broadly-shared tables (see init_schema's
-- customers_select/customers_write, etc.).
create policy "content_translations_select" on public.content_translations
  for select to authenticated using (true);

create policy "content_translations_insert" on public.content_translations
  for insert to authenticated with check (true);

-- Needed for the upsert's ON CONFLICT DO UPDATE path (re-translating a
-- row whose source_hash changed replaces the existing cached row rather
-- than erroring on the unique constraint).
create policy "content_translations_update" on public.content_translations
  for update to authenticated using (true);

create index if not exists content_translations_lookup_idx
  on public.content_translations (entity_type, entity_id, field_name, locale);
