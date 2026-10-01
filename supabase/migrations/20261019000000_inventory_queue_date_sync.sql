-- Keeps a job's still-pending Inventory Approvals entries dated to the job's
-- completion date when that date is changed afterwards.
--
-- Before: a Filter Change's Acc D or an install's Installed Date changed
-- after completion (e.g. the auto-filled "today" corrected to the real day)
-- left its pending stock movements on the original date, so the Inventory
-- List showed them on the wrong day. Now the pending entries follow the
-- date. Approved / rejected entries are never touched — those are already
-- part of stock history.
--
-- Both functions are otherwise exactly as in the
-- filter_change_inventory_queue and inventory_queue_installs_repairs
-- migrations; only the new date-change branch is added. (Repairs aren't
-- included: their entries come from recorded parts, dated by each part.)

create or replace function public.queue_filter_change_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_completed boolean;
  v_was_completed boolean := false;
  v_code record;
  v_product_id uuid;
begin
  v_completed := NEW.status <> 'Cancelled' and (NEW.status = 'Completed' or NEW.acc_d is not null);
  if TG_OP = 'UPDATE' then
    v_was_completed := OLD.status <> 'Cancelled' and (OLD.status = 'Completed' or OLD.acc_d is not null);
  end if;

  if v_completed and not v_was_completed then
    if exists (select 1 from public.stock_movements where filter_change_plan_id = NEW.id) then
      return NEW;
    end if;
    if NEW.schedule_job_id is not null
       and exists (select 1 from public.stock_movements where schedule_job_id = NEW.schedule_job_id) then
      return NEW;
    end if;

    for v_code in
      select trim(code) as code, count(*)::integer as qty
      from unnest(string_to_array(coalesce(NEW.filter_type, ''), ',')) as code
      where trim(code) <> ''
      group by trim(code)
    loop
      select id into v_product_id from public.products where trim(sku) = v_code.code order by date_added limit 1;
      continue when v_product_id is null;
      insert into public.stock_movements (
        date, product_id, quantity_added, quantity_removed,
        reason, user_id, reference_number, filter_change_plan_id, status
      )
      values (
        coalesce(NEW.acc_d, current_date),
        v_product_id,
        0,
        v_code.qty,
        'Filter Change',
        auth.uid(),
        coalesce(nullif(NEW.order_number, ''), NEW.id::text),
        NEW.id,
        'pending'
      );
    end loop;
  elsif TG_OP = 'UPDATE' and v_was_completed and not v_completed then
    delete from public.stock_movements where filter_change_plan_id = NEW.id and status = 'pending';
  elsif TG_OP = 'UPDATE' and v_completed and NEW.acc_d is not null and NEW.acc_d is distinct from OLD.acc_d then
    -- Still completed, Acc D changed: move its pending entries to the new date.
    update public.stock_movements set date = NEW.acc_d
      where filter_change_plan_id = NEW.id and status = 'pending';
  end if;

  return NEW;
end;
$$;

create or replace function public.queue_install_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_product_id uuid;
  v_code text;
begin
  if new.installed_date is not null and (TG_OP = 'INSERT' or old.installed_date is null) then
    if coalesce(trim(new.model), '') = ''
       or exists (select 1 from public.stock_movements where install_plan_id = new.id) then
      return new;
    end if;
    v_code := trim(split_part(new.model, ' / ', 1));
    select id into v_product_id from public.products where trim(sku) = v_code order by date_added limit 1;
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, install_plan_id, status
    )
    values (
      new.installed_date,
      v_product_id,
      trim(new.model),
      0,
      1,
      'Installation',
      auth.uid(),
      coalesce(nullif(new.order_no, ''), new.id::text),
      new.id,
      'pending'
    );
  elsif TG_OP = 'UPDATE' and old.installed_date is not null and new.installed_date is null then
    delete from public.stock_movements where install_plan_id = new.id and status = 'pending';
  elsif TG_OP = 'UPDATE' and old.installed_date is not null and new.installed_date <> old.installed_date then
    -- Installed Date changed: move its pending entry to the new date.
    update public.stock_movements set date = new.installed_date
      where install_plan_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;
