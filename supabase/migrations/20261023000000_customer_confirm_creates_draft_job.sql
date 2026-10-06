-- 3-step dispatch pipeline, Step 2: a customer's confirmation creates a
-- DRAFT schedule job, not an active one.
--
--   Step 1  Admin pre-approval      Draft -> Pending Customer Confirmation
--                                   (approve_dispatch_item; first visit per
--                                   order and manually added visits)
--   Step 2  Customer confirmation   -> Confirmed, and a schedule job is created
--                                   as 'pending_approval' (this migration),
--                                   then auto-assigned by the dispatch rules
--                                   (/api/dispatch/respond)
--   Step 3  Final admin approval    'pending_approval' -> 'pending' ("Approve &
--                                   Dispatch All Drafts"): the job reaches the
--                                   technician (RLS hides pending_approval)
--                                   and the Daily Report widgets
--
-- find_or_create_schedule_job() is shared by respond_to_dispatch_confirmation
-- (customer confirms) and accept_requested_reschedule (admin accepts the
-- date a customer asked for); both now land in Step 3's review. Unchanged
-- otherwise: it still reuses an open job ('pending' or 'pending_approval')
-- of the same type, order and date, and a reused job keeps its status.
-- Callers already link the visit to the job themselves, so the deferred
-- ensure_schedule_job_module_record trigger finds it linked when the job is
-- approved.

create or replace function public.find_or_create_schedule_job(
  p_job_type public.schedule_job_type,
  p_customer_id uuid,
  p_order_no text,
  p_scheduled_date date,
  p_scheduled_time text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if p_order_no is not null and p_order_no <> '' then
    select id into v_job_id
      from public.schedule_jobs
      where job_type = p_job_type
        and status in ('pending', 'pending_approval')
        and scheduled_date = p_scheduled_date
        and order_no = p_order_no
      limit 1;
  end if;

  if v_job_id is not null then
    return v_job_id;
  end if;

  insert into public.schedule_jobs (job_type, customer_id, order_no, scheduled_date, scheduled_time, status, source)
  values (p_job_type, p_customer_id, p_order_no, p_scheduled_date, nullif(p_scheduled_time, ''), 'pending_approval', 'customer_confirmed')
  returning id into v_job_id;

  return v_job_id;
end;
$$;
