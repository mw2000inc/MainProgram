-- =========================================================================
-- Where each schedule job came from, so the Schedule views can badge the
-- ones the system created.
--
--   manual             — added by an admin (Schedule form) — the default
--   automation         — the daily filter-change automation
--   auto_suggest       — an errand / bundled task added in the Auto-suggest modal
--   customer_confirmed — created when a customer confirmed (or accepted a
--                        reschedule of) a Dispatch record — find_or_create_schedule_job
--
-- Existing rows are backfilled from what they already carry: the automation's
-- "Auto-generated — …" note, and a linked module record the customer
-- responded to. Anything else stays 'manual' (Auto-suggest errands left no
-- trace before this column, so older ones can't be told apart).
-- =========================================================================

alter table public.schedule_jobs
  add column if not exists source text not null default 'manual';

alter table public.schedule_jobs drop constraint if exists schedule_jobs_source_check;
alter table public.schedule_jobs
  add constraint schedule_jobs_source_check
  check (source in ('manual', 'automation', 'auto_suggest', 'customer_confirmed'));

update public.schedule_jobs set source = 'automation'
  where source = 'manual' and notes ilike 'Auto-generated%';

update public.schedule_jobs j set source = 'customer_confirmed'
  where j.source = 'manual'
    and (
      exists (select 1 from public.filter_change_plans p where p.schedule_job_id = j.id and p.customer_responded_at is not null)
      or exists (select 1 from public.install_plans p where p.schedule_job_id = j.id and p.customer_responded_at is not null)
      or exists (select 1 from public.repair_plans p where p.schedule_job_id = j.id and p.customer_responded_at is not null)
      or exists (select 1 from public.collections p where p.schedule_job_id = j.id and p.customer_responded_at is not null)
    );

-- Same function as in the schedule_pending_approval_rls_and_dedup migration;
-- only its INSERT now records source = 'customer_confirmed'.
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
  values (p_job_type, p_customer_id, p_order_no, p_scheduled_date, nullif(p_scheduled_time, ''), 'pending', 'customer_confirmed')
  returning id into v_job_id;

  return v_job_id;
end;
$$;
