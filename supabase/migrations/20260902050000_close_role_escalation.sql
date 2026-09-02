-- Closes the remaining self-signup-to-admin privilege escalation, confirmed
-- live via a direct functional test: a public, anon-key
--   supabase.auth.signUp({ email, password, options: { data: { role: "admin" } } })
-- call (bypassing the /login form entirely — no code path there sends a
-- role) still produced an admin profile, because handle_new_user() fell back
-- to raw_user_meta_data.role whenever app_metadata.role was absent. That
-- fallback was added in 20260830140000 as a safety net against a since-fixed
-- bug (app_metadata.role not landing correctly), but it always doubled as an
-- attacker-controlled path: raw_user_meta_data is exactly the one field a
-- public signUp() call can set directly, and the anon key it requires is not
-- a secret — it ships in the client bundle.
--
-- Fix: drop the raw_user_meta_data.role branch entirely. role now comes only
-- from raw_app_meta_data, which can only be set via the privileged,
-- service-role Admin API (src/app/api/admin/users/route.ts, gated on an
-- authenticated admin caller) — never from a public signUp() call, no matter
-- what payload it sends. Default stays 'technician', the least-privileged
-- role, for any signup with no app_metadata.role at all (ordinary self-signup
-- included).
--
-- No backfill needed: this only changes how NEW profiles rows are created
-- going forward. The live account audit that led to this fix found no
-- existing profile that got its role from this branch incorrectly — the six
-- current admin accounts were all created before either the escalation bug
-- or this fix existed, and already have role = 'admin' persisted directly.
--
-- Net effect: public self-signup (the /login form, or anyone calling
-- signUp() directly with any crafted payload) can no longer produce an admin
-- account, period. The only ways left to create an admin account are (a) an
-- existing admin creating one via the Users page, or (b) a manual
-- `update public.profiles set role = 'admin' where id = '<uuid>'` run
-- directly in the SQL editor — see /login's updated copy and the
-- fix_handle_new_user_role_metadata migration's own note that this decision
-- was deliberately left for a follow-up rather than made unilaterally there.
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
    coalesce((new.raw_app_meta_data->>'role')::public.app_role, 'technician'::public.app_role)
  );
  return new;
end;
$$;
