-- An approved schedule job is the final approval: its linked Filter Change /
-- install / collection / repair record is Confirmed, so it shows on the
-- Daily Report without a second approval in the Draft-records queue.
--
-- Why: the Daily Report shows a Pending record only when its dispatch_status
-- is 'Confirmed' AND its schedule job is approved ('pending' / 'completed').
-- A job approved in the Schedule is linked to a record by
-- ensure_schedule_job_module_record (20261020000000): a record it CREATES
-- gets the column default 'Confirmed', but a record it LINKS (the nearest
-- open record for the same order within 60 days) keeps whatever
-- dispatch_status it had. A 'Draft' record (an order's first visit, or one
-- added through a module's own Add form) therefore stayed off the Daily
-- Report until someone also approved it in Pending Approvals.
--
-- Now:
-- 1. When a job becomes approved (moves from 'pending_approval', or any
--    other unapproved status, to 'pending' or 'completed'), every record
--    already linked to it that is still 'Draft' or 'Pending Customer
--    Confirmation' becomes 'Confirmed'.
-- 2. When a record is linked to (or inserted with) a job that is already
--    approved, the same happens to that record. This covers the deferred
--    link ensure_schedule_job_module_record makes at commit, after the
--    status change in (1) has already run.
--
-- Not changed: 'Reschedule Requested' (the customer asked for another date;
-- that stays an admin decision in Pending Approvals), 'Rejected', and
-- 'Confirmed' records. No email, push or confirmation link is sent from
-- here; a 'Pending Customer Confirmation' record's outstanding link simply
-- stops being needed. The audit trigger records each change under the
-- approving admin.
--
-- Running this changes no existing rows: it only creates two functions and
-- their triggers (it redefines no existing function), and triggers act
-- only on later writes. No backfill needed: checked live before writing
-- this, every record currently linked to a schedule job is already
-- 'Confirmed'.

create or replace function public.confirm_records_of_approved_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Only the moment a job BECOMES approved: an already-approved job that is
  -- later completed, moved or reassigned changes nothing here.
  if NEW.status not in ('pending', 'completed') or OLD.status in ('pending', 'completed') then
    return null;
  end if;
  update public.filter_change_plans set dispatch_status = 'Confirmed'
    where schedule_job_id = NEW.id and dispatch_status in ('Draft', 'Pending Customer Confirmation');
  update public.install_plans set dispatch_status = 'Confirmed'
    where schedule_job_id = NEW.id and dispatch_status in ('Draft', 'Pending Customer Confirmation');
  update public.collections set dispatch_status = 'Confirmed'
    where schedule_job_id = NEW.id and dispatch_status in ('Draft', 'Pending Customer Confirmation');
  update public.repair_plans set dispatch_status = 'Confirmed'
    where schedule_job_id = NEW.id and dispatch_status in ('Draft', 'Pending Customer Confirmation');
  return null;
end;
$$;

drop trigger if exists trg_confirm_records_of_approved_job on public.schedule_jobs;
create trigger trg_confirm_records_of_approved_job
  after update of status on public.schedule_jobs
  for each row execute function public.confirm_records_of_approved_job();

create or replace function public.confirm_record_linked_to_approved_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if NEW.schedule_job_id is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and NEW.schedule_job_id is not distinct from OLD.schedule_job_id then
    return NEW;
  end if;
  if NEW.dispatch_status in ('Draft', 'Pending Customer Confirmation')
     and exists (select 1 from public.schedule_jobs where id = NEW.schedule_job_id and status in ('pending', 'completed')) then
    NEW.dispatch_status := 'Confirmed';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_confirm_record_linked_to_approved_job on public.filter_change_plans;
create trigger trg_confirm_record_linked_to_approved_job
  before insert or update of schedule_job_id on public.filter_change_plans
  for each row execute function public.confirm_record_linked_to_approved_job();

drop trigger if exists trg_confirm_record_linked_to_approved_job on public.install_plans;
create trigger trg_confirm_record_linked_to_approved_job
  before insert or update of schedule_job_id on public.install_plans
  for each row execute function public.confirm_record_linked_to_approved_job();

drop trigger if exists trg_confirm_record_linked_to_approved_job on public.collections;
create trigger trg_confirm_record_linked_to_approved_job
  before insert or update of schedule_job_id on public.collections
  for each row execute function public.confirm_record_linked_to_approved_job();

drop trigger if exists trg_confirm_record_linked_to_approved_job on public.repair_plans;
create trigger trg_confirm_record_linked_to_approved_job
  before insert or update of schedule_job_id on public.repair_plans
  for each row execute function public.confirm_record_linked_to_approved_job();
