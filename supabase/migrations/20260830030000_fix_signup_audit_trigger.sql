-- Fixes a signup-breaking bug in the audit_logging migration
-- (20260830020000): public self-signup started failing with a 500
-- ("Database error saving new user") because handle_new_user()'s insert
-- into public.profiles now fires set_audit_columns() (added by that
-- migration) as a BEFORE INSERT trigger, and — unlike log_audit_event(),
-- which was already wrapped in its own exception handler — that function
-- had no protection against an unexpected error of its own. Any error
-- inside a BEFORE trigger fails the entire statement it's attached to, so
-- a bug in this bookkeeping trigger was enough to fail the real
-- auth.users/profiles insert that handle_new_user() performs on every
-- signup (Google signup and admin-created accounts go through the same
-- path and would hit the same failure).
--
-- Applying the same "must never block the real write" principle already
-- used for log_audit_event(): wrap the actual column assignments in their
-- own exception handler. On success, created_by/updated_by/updated_at are
-- set exactly as before. If anything in there throws for any reason, the
-- whole inner block's assignments are rolled back (so NEW is left exactly
-- as the calling statement supplied it) and the row is still written,
-- audit columns unset, rather than failing the write outright — a missed
-- audit stamp is a far smaller problem than a broken signup.
create or replace function public.set_audit_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  begin
    if TG_OP = 'INSERT' then
      new.created_by := coalesce(auth.uid(), new.created_by);
      new.updated_by := coalesce(auth.uid(), new.updated_by);
      new.updated_at := now();
    elsif TG_OP = 'UPDATE' then
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      new.updated_by := coalesce(auth.uid(), new.updated_by);
      new.updated_at := now();
    end if;
  exception when others then
    null; -- swallow — see the comment above this function
  end;
  return new;
end;
$$;
