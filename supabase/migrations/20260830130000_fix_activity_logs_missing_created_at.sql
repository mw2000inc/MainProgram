-- Root-cause fix for "Admin/Technician Activity log isn't recording
-- anything", reported by Marvs.
--
-- What's actually happening, confirmed by inspecting the live database
-- directly (via the PostgREST schema + direct REST queries), not guessed:
--
--   * The audit triggers ARE working. activity_logs currently holds 500+
--     rows, 300+ of them in the full post-audit_logging-migration shape
--     (entity_type/entity_id/description/old_values/new_values all
--     populated correctly) going back to when that migration first went
--     live. Writes are not the problem.
--
--   * The READ side is 100% broken: activity_logs, live, right now, has NO
--     `created_at` column at all — confirmed directly against Postgres's
--     own schema (PostgREST's OpenAPI definition lists exactly
--     id/user_id/action/date/time/ip_address/entity_type/entity_id/
--     description/old_values/new_values, and a raw `select=created_at`
--     query 400s with `42703: column activity_logs.created_at does not
--     exist`). src/lib/api/activity-logs.ts's listActivityLogsByRole() —
--     which powers BOTH the Admin Activity and Technician Activity pages —
--     filters and orders by created_at, and getLatestActivityForEntity()
--     (the "Last edited by" indicator) does too. Every one of those reads
--     has been failing outright. That is what actually reads as "nothing
--     is being recorded" — the data is there, the page just can't query it.
--
--   * Every OTHER column/table touched by the same 20260830020000 migration
--     (entity_type et al. on activity_logs itself, user_id's dropped NOT
--     NULL, and created_by/updated_by/updated_at on all 15 instrumented
--     tables) is confirmed present and working live. Since all of that came
--     from the exact same migration file/run as the activity_logs
--     `created_at` column, the most consistent explanation is that
--     `created_at` was removed from activity_logs afterwards by a manual,
--     out-of-band change (e.g. in the Studio Table Editor) — nothing in the
--     migration history ever drops it. Whatever the exact cause, the fix is
--     the same: put it back.
--
--   * Marvs' 42710 ("policy already exists") is a separate symptom of the
--     same incident: `create policy "activity_logs_select_admin"` in
--     20260830020000 has no `drop policy if exists` guard (every trigger in
--     that same file does use drop-if-exists + recreate, this one policy
--     line was missed). Once that policy exists — which it does, since the
--     original run did succeed — re-running that file, or just those
--     lines, by hand to try to fix the missing-created_at problem fails
--     immediately on this line, before it ever reaches anything that could
--     have re-added the column. Fixed below by adding the missing guard.

-- =========================================================================
-- 1. Restore created_at, backfilled from the existing date/time columns so
--    historical ordering is still meaningful (rather than every pre-existing
--    row collapsing onto the single instant this migration happens to run
--    at, which is what a bare `default now()` would do for rows that
--    already exist at ALTER time).
-- =========================================================================
alter table public.activity_logs add column if not exists created_at timestamptz;

-- Row by row, not a single bulk UPDATE, so one malformed legacy `time`
-- value (this column predates any format validation) can't throw and abort
-- backfilling every other row — it just falls through to the "now()"
-- fallback below for that one row instead.
do $$
declare
  r record;
begin
  for r in select id, date, time from public.activity_logs where created_at is null loop
    begin
      update public.activity_logs
        set created_at = ((r.date::text || ' ' || r.time)::timestamp at time zone 'utc')
        where id = r.id;
    exception when others then
      null; -- leave it null — picked up by the fallback update just below
    end;
  end loop;
end $$;

-- Anything that couldn't be parsed above (or genuinely predates `date`/
-- `time` being populated) — fall back to "now" rather than leaving a null
-- that would still break `order by created_at` / range filters.
update public.activity_logs set created_at = now() where created_at is null;

alter table public.activity_logs alter column created_at set default now();
alter table public.activity_logs alter column created_at set not null;

-- =========================================================================
-- 2. Make the select policy idempotent — this exact statement is what threw
--    42710 for Marvs. Safe to run any number of times from here on.
-- =========================================================================
drop policy if exists "activity_logs_select_admin" on public.activity_logs;
create policy "activity_logs_select_admin" on public.activity_logs
  for select to authenticated using (public.is_admin());

-- =========================================================================
-- 3. Force PostgREST to pick up the schema change immediately rather than
--    waiting for its own change-detection to notice — cheap and harmless
--    even if it would have noticed on its own.
-- =========================================================================
notify pgrst, 'reload schema';
