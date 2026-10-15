-- Fix: technicians couldn't mark their jobs done ("Failed to update job").
--
-- restrict_schedule_job_technician_update() (BEFORE UPDATE on schedule_jobs)
-- lets a non-admin change only status and remarks, by comparing the whole old
-- and new row as JSON. 20261109000000 added the GENERATED column
-- technician_user_ids — and in a BEFORE trigger Postgres hasn't computed a
-- generated column's new value yet, so NEW has it as NULL while OLD has the
-- list. Every technician update therefore looked like a change to another
-- column and raised "Technicians may only update a job's status and
-- remarks" — even a plain status + remarks save. Admins skip the check, so
-- only technicians were affected.
--
-- Generated columns are now left out of the comparison (all of them, looked
-- up from the catalog, so a future one can't cause this again). They can
-- never be written directly anyway — they're computed from columns the
-- comparison still covers. Everything else is unchanged from
-- 20260908070000_schedule_pending_approval_rls_and_dedup.

create or replace function public.restrict_schedule_job_technician_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_generated text[];
begin
  if not public.is_admin() and auth.uid() is not null then
    if OLD.status = 'pending_approval' then
      raise exception 'Only an admin can modify a schedule that is still pending approval';
    end if;
    select coalesce(array_agg(a.attname::text), '{}')
      into v_generated
      from pg_attribute a
      where a.attrelid = TG_RELID and a.attgenerated <> '' and a.attnum > 0 and not a.attisdropped;
    v_old := (to_jsonb(OLD) - 'status' - 'remarks' - 'updated_at' - 'updated_by') - v_generated;
    v_new := (to_jsonb(NEW) - 'status' - 'remarks' - 'updated_at' - 'updated_by') - v_generated;
    if v_old is distinct from v_new then
      raise exception 'Technicians may only update a job''s status and remarks';
    end if;
  end if;
  return NEW;
end;
$$;
