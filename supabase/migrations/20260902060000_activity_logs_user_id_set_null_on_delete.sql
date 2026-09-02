-- Fixes account deletion silently failing. activity_logs.user_id was
-- declared `references public.profiles(id)` with no ON DELETE clause back in
-- init_schema, which defaults to NO ACTION (restrict): deleting a profile
-- that has ever had an audit-logged action against it — which is
-- essentially every user, since account creation itself gets logged by
-- log_audit_event() — fails with a foreign key violation. Confirmed live:
-- admin.auth.admin.deleteUser() surfaced this as an opaque 500 from the Auth
-- API when the profiles row it cascades to delete still had a referencing
-- activity_logs row.
--
-- Fix: drop and re-add the constraint with ON DELETE SET NULL, matching the
-- pattern already used for created_by/updated_by everywhere else (see
-- 20260830020000_audit_logging.sql) and made possible by user_id already
-- being nullable (20260830050000 dropped its NOT NULL). Deleting a user now
-- leaves their past audit entries in place with user_id = null instead of
-- blocking the delete — a rare null-actor row on an already-gone account is
-- a far smaller problem than user deletion not working at all.
alter table public.activity_logs
  drop constraint if exists activity_logs_user_id_fkey;

alter table public.activity_logs
  add constraint activity_logs_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
