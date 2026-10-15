-- Release Slip: a job counts as done when its RECORD is done, too.
--
-- get_release_slip (20261029000000) took only the day's 'completed' jobs
-- (plus 'pending' ones when asked), and the slip page prints a pending job
-- with blank OUT lines. A job can be un-ticked back to 'pending' after it was
-- marked done — un-completing a job leaves its record completed and its
-- queued stock movements in place (20261027000000). That job then vanished
-- from the slip with its items: 001-0864 on 2026-10-15 (Filter Change record
-- Completed, Acc D 10/15, filter 013 queued; job un-ticked to pending).
--
-- Now an approved ('pending') job whose Filter Change record is Completed or
-- has an Acc D — or whose Collection is collected, or Installation / Repair
-- is Completed — is on the slip like a completed job and reported as
-- 'completed', so its items print. Drafts and cancelled jobs are still left
-- out; everything else is unchanged.

create or replace function public.get_release_slip(
  p_date date,
  p_technician_user_id uuid default null,
  p_include_pending boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_target uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  select exists (select 1 from public.profiles where id = v_uid and role = 'admin') into v_is_admin;
  -- A technician always gets their own slip, whatever was asked for.
  v_target := case when v_is_admin then p_technician_user_id else v_uid end;

  select jsonb_build_object(
    'technician_name', (select name from public.profiles where id = v_target),
    'jobs', coalesce(jsonb_agg(job_row order by job_row->>'technician', job_row->>'order_no'), '[]'::jsonb)
  )
  into v_result
  from (
    select jsonb_build_object(
      'job_id', j.id,
      'order_no', coalesce(j.order_no, ''),
      'account_name', coalesce(
        nullif(c.company_name, ''), nullif(c.full_name, ''),
        nullif(fc.member_account, ''), nullif(col.account_name, ''), nullif(ip.name, ''), nullif(rp.account_name, ''),
        nullif(split_part(coalesce(j.notes, ''), ' — ', 1), ''),
        ''
      ),
      'job_type', j.job_type::text,
      'status', case when j.status::text = 'completed' or d.record_done then 'completed' else j.status::text end,
      'scheduled_date', j.scheduled_date,
      'technician', coalesce(j.technician, ''),
      'technician_2', coalesce(j.technician_2, ''),
      'movements', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'sku', coalesce(p.sku, ''),
                 'label', coalesce(m.item_label, p.name, ''),
                 'qty_out', coalesce(m.quantity_removed, 0),
                 'qty_in', coalesce(m.quantity_added, 0),
                 'status', m.status
               ) order by coalesce(p.sku, m.item_label, ''), m.created_at)
        from public.stock_movements m
        left join public.products p on p.id = m.product_id
        where m.status is distinct from 'rejected'
          and (
            m.schedule_job_id = j.id
            or m.filter_change_plan_id in (select f.id from public.filter_change_plans f where f.schedule_job_id = j.id)
            or m.install_plan_id in (select i.id from public.install_plans i where i.schedule_job_id = j.id)
            or m.repair_plan_part_id in (
              select pp.id from public.repair_plan_parts pp
              join public.repair_plans r on r.id = pp.repair_plan_id
              where r.schedule_job_id = j.id
            )
          )
      ), '[]'::jsonb)
    ) as job_row
    from public.schedule_jobs j
    left join lateral (
      select c1.company_name, c1.full_name from public.customers c1
      where c1.id = j.customer_id
         or (j.customer_id is null and nullif(trim(j.order_no), '') is not null and (
              c1.id = (select e.customer_id from public.sale_list_entries e where e.order_number = trim(j.order_no) and e.customer_id is not null limit 1)
              or trim(c1.order_number) = trim(j.order_no)))
      order by (c1.id = j.customer_id) desc nulls last
      limit 1
    ) c on true
    left join lateral (select f.member_account from public.filter_change_plans f where f.schedule_job_id = j.id limit 1) fc on true
    left join lateral (select x.account_name from public.collections x where x.schedule_job_id = j.id limit 1) col on true
    left join lateral (select i.name from public.install_plans i where i.schedule_job_id = j.id limit 1) ip on true
    left join lateral (select r.account_name from public.repair_plans r where r.schedule_job_id = j.id limit 1) rp on true
    -- Done on its record: an approved ('pending') job whose Filter Change /
    -- Collection / Installation / Repair record is already completed.
    left join lateral (
      select j.status::text = 'pending' and (
        exists (select 1 from public.filter_change_plans f where f.schedule_job_id = j.id and (f.status = 'Completed' or f.acc_d is not null))
        or exists (select 1 from public.collections x where x.schedule_job_id = j.id and (x.collected or x.status = 'Collected'))
        or exists (select 1 from public.install_plans i where i.schedule_job_id = j.id and i.status = 'Completed')
        or exists (select 1 from public.repair_plans r where r.schedule_job_id = j.id and r.status = 'Completed')
      ) as record_done
    ) d on true
    where j.scheduled_date = p_date
      and (j.status::text = 'completed' or d.record_done or (p_include_pending and j.status::text = 'pending'))
      and (v_target is null or j.technician_user_id = v_target or j.technician_2_user_id = v_target)
  ) jobs;

  return v_result;
end;
$$;

revoke all on function public.get_release_slip(date, uuid, boolean) from public;
revoke all on function public.get_release_slip(date, uuid, boolean) from anon;
grant execute on function public.get_release_slip(date, uuid, boolean) to authenticated;
