-- Fixes technician accounts silently getting role = 'admin'.
--
-- Root cause: the technician_role migration (20260829000000) rewrote
-- handle_new_user() to read role from raw_app_meta_data (correctly, since
-- that's the one field a public, anon-key signUp() call can never set —
-- see that migration's own comment) but defaulted to 'admin' whenever it
-- was absent:
--
--   coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'admin')
--
-- That default is backwards for safety: ANY case where app_metadata.role
-- doesn't come through — a bug, a timing issue in how the Admin API call
-- actually lands the row, anything unanticipated — silently grants admin
-- instead of the least-privileged role. src/app/api/admin/users/route.ts
-- (the only place that ever sets app_metadata.role, exclusively for admin-
-- created technician accounts) does pass app_metadata: { role } correctly,
-- so this default should rarely matter — but "rarely" defaulting to the
-- most privileged role in the whole app is exactly the wrong place to leave
-- any doubt, which is the actual bug being fixed here.
--
-- Fix: also check raw_user_meta_data.role, and change the final fallback to
-- 'technician'. Note this does NOT newly expose self-signup to attacker-
-- controlled privilege escalation: raw_user_meta_data is already the one
-- field a public signUp() call can set directly (bypassing the login page's
-- own form, which never sends a role at all), and today's live behavior is
-- that EVERY self-signup unconditionally becomes admin — that's the
-- existing, deliberate "Create your Admin account" design on /login. This
-- change only narrows that: a normal self-signup (no role in either
-- metadata field) now lands on 'technician' instead of 'admin', an
-- unambiguous improvement. It remains possible for someone calling
-- supabase.auth.signUp() directly with a crafted `data: { role: "admin" }`
-- payload to still land on admin via the second coalesce branch — exactly
-- as possible today, just no longer the automatic default. Closing that
-- path for good would mean self-signup can never become admin at all,
-- which is a real product decision (this app currently has no other way to
-- create its first admin account) and out of scope for this fix — flagged
-- here rather than decided unilaterally.
--
-- Note the login page's sign-up copy ("Create your Admin account —
-- Technician accounts are set up by an admin from the Users page") is now
-- only accurate for the case where nothing else applies; it's still true
-- that self-signup is the only way to bootstrap an admin, but it no longer
-- guarantees the *result* is an admin account the instant app/user metadata
-- disagrees. Not changed here (UI copy, out of this migration's scope) —
-- worth a follow-up.
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
    coalesce(
      (new.raw_app_meta_data->>'role')::public.app_role,
      (new.raw_user_meta_data->>'role')::public.app_role,
      'technician'::public.app_role
    )
  );
  return new;
end;
$$;

-- Backfill: correct any profile that was already, incorrectly, defaulted to
-- 'admin' by the old function despite its own auth.users row's metadata
-- actually saying 'technician'. Deliberately narrow — only touches rows
-- where profiles.role = 'admin' AND at least one metadata field explicitly
-- says 'technician', so it can never touch a real, intentionally-admin
-- account (one where metadata says 'admin', or says nothing at all — the
-- ambiguous case this migration can't safely guess at retroactively).
-- Idempotent: re-running finds nothing to update once applied, since the
-- rows it corrects no longer match role = 'admin' afterward.
update public.profiles p
set role = 'technician'
from auth.users u
where p.id = u.id
  and p.role = 'admin'
  and (
    (u.raw_app_meta_data->>'role') = 'technician'
    or (u.raw_user_meta_data->>'role') = 'technician'
  );
