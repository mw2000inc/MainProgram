-- A Filter Change job without a linked Filter Change record deducts its own
-- filters when it's completed — however it's completed.
--
-- A job's filters are its filter_codes ("011, 011, 013": a code repeated once
-- per unit — the Schedule Job form's "Filters to Deduct" rows are saved this
-- way). When the job has a linked Filter Change record, completing the job
-- completes the record (20261027000000) and the record's own trigger queues
-- its Filter's codes as pending stock movements (20261019000000). A job with
-- NO linked record only had its codes queued by the batch "Mark as
-- Completed" (complete-jobs.ts, step 3); the single "Mark done" tick — by an
-- admin or the technician — queued nothing.
--
-- Now, when a filter_change job BECOMES completed, has no linked Filter Change
-- record and no stock movement yet, each of its codes is queued exactly as the
-- batch does: one pending movement per code, quantity = times listed, matched
-- to the product by SKU (the earliest added, like every other path), dated
-- today (Manila), reason 'Filter Change', reference = Order No. A code with no
-- product (typed by hand) is skipped. Pending movements wait for an admin's
-- approval in Inventory, as always.
--
-- No double counting: the batch route completes its jobs first (this trigger
-- queues), then skips any job that already has movements; filter items added
-- in the Mark done dialog skip products already queued for the job
-- (handle_schedule_job_filter_item, 20261027000000). Un-completing changes
-- nothing (same as the batch). Changes no existing rows.

create or replace function public.queue_unlinked_job_filter_codes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code record;
  v_product_id uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if NEW.status <> 'completed' or OLD.status = 'completed' then
    return null;
  end if;
  if NEW.job_type <> 'filter_change' or trim(coalesce(NEW.filter_codes, '')) = '' then
    return null;
  end if;
  if exists (select 1 from public.filter_change_plans where schedule_job_id = NEW.id) then
    return null;
  end if;
  if exists (select 1 from public.stock_movements where schedule_job_id = NEW.id) then
    return null;
  end if;

  for v_code in
    select trim(code) as code, count(*)::integer as qty
    from unnest(string_to_array(NEW.filter_codes, ',')) as code
    where trim(code) <> ''
    group by trim(code)
  loop
    select id into v_product_id from public.products where trim(sku) = v_code.code order by date_added limit 1;
    continue when v_product_id is null;
    insert into public.stock_movements (
      date, product_id, quantity_added, quantity_removed,
      reason, user_id, reference_number, schedule_job_id, status
    )
    values (
      v_today,
      v_product_id,
      0,
      v_code.qty,
      'Filter Change',
      auth.uid(),
      coalesce(nullif(trim(NEW.order_no), ''), NEW.id::text),
      NEW.id,
      'pending'
    );
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_queue_unlinked_job_filter_codes on public.schedule_jobs;
create trigger trg_queue_unlinked_job_filter_codes
  after update of status on public.schedule_jobs
  for each row execute function public.queue_unlinked_job_filter_codes();
