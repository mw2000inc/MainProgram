-- Smart Automatic Scheduling System needs to write technician + location +
-- route_sequence onto a brand-new schedule_jobs row from server-side code
-- (src/lib/scheduling/smart-schedule.ts) using the service-role admin
-- client -- Postgres itself can't call out to Nominatim for geocoding, so
-- this can't be done inside a trigger/RPC the way find_or_create_schedule_job's
-- own INSERT is; it has to be a follow-up UPDATE from the API route after
-- the RPC returns (see auto_create_schedule_job_on_confirm's own comment on
-- this exact HTTP-from-Postgres limitation).
--
-- restrict_schedule_job_technician_update (technician_job_status_update
-- migration) currently blocks any UPDATE to schedule_jobs' technician/
-- location/etc. columns unless is_admin() -- and is_admin() reads
-- auth.uid(), which is genuinely null for a service-role call (no JWT/
-- session at all), so that UPDATE would be rejected exactly as if a
-- technician had attempted it.
--
-- Checked before choosing a fix (same discipline as fix_reschedule_accept):
-- schedule_jobs_update's own USING clause is `for update to authenticated`
-- -- anon can never reach this trigger at all (RLS blocks it before the
-- trigger fires), and every real authenticated session always has a
-- non-null auth.uid(). So `auth.uid() is null` inside this trigger can only
-- ever mean one thing in practice: the service-role client, which bypasses
-- RLS entirely and is never exposed to any browser/client code (see
-- src/lib/supabase/admin.ts's own header comment -- server-only, route
-- handlers only). Extending the trigger's exemption to that specific,
-- unambiguous case is narrower than the alternative (a new SECURITY DEFINER
-- RPC just to relocate this one UPDATE, which is still ultimately called by
-- the same trusted server-side code and would need the exact same trust
-- boundary anyway) and doesn't touch what it already protects against: a
-- technician's own authenticated session still always has a non-null
-- auth.uid(), so this changes nothing for that case.
create or replace function public.restrict_schedule_job_technician_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if not public.is_admin() and auth.uid() is not null then
    v_old := to_jsonb(OLD) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    v_new := to_jsonb(NEW) - 'status' - 'remarks' - 'updated_at' - 'updated_by';
    if v_old is distinct from v_new then
      raise exception 'Technicians may only update a job''s status and remarks';
    end if;
  end if;
  return NEW;
end;
$$;
