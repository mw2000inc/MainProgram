-- Installs: draft the unit's stock movement when the install is CREATED (or
-- first given a model), not only once its Installed Date is set.
--
-- Before: queue_install_inventory() queued the unit ('pending', 1 out) only
-- when installed_date was filled in, and removed that pending row if the date
-- was cleared — so a scheduled install was invisible to the Inventory List /
-- approval queue until after the unit had already gone out. Repairs already
-- draft a pending movement the moment a part is recorded
-- (handle_repair_plan_part_stock_movement) and are unchanged.
--
-- Now, for every install with a model:
--   * no movement yet        → insert one, status 'pending', 1 unit out
--                              (quantity_removed = 1; there is no separate
--                              movement-type column), dated installed_date,
--                              else the planned date (pre_installed_date),
--                              else input_date; matched to the product whose
--                              SKU is the model's code before ' / ' (else
--                              left unmapped with the model as item_label,
--                              for the admin to map in the queue);
--   * a still-PENDING movement → kept in step with the install's model and
--                              date (rescheduled, model corrected, installed);
--   * an approved / rejected movement → never touched again;
--   * model cleared, or the install deleted → its pending movement is removed.
-- Stock is still only deducted on approval: every stock trigger
-- (apply_stock_movement*, reverse_stock_movement) acts on approved rows only,
-- and stock_movements_approved_needs_product blocks approving an unmapped row.
--
-- No backfill needed: checked live, all 22 installs already have an
-- Installed Date (and so went through the old path).

create or replace function public.queue_install_inventory()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_model text := trim(coalesce(new.model, ''));
  v_date date := coalesce(new.installed_date, new.pre_installed_date, new.input_date);
  v_product_id uuid;
  v_existing record;
begin
  select id, status into v_existing
    from public.stock_movements
    where install_plan_id = new.id
    order by created_at
    limit 1;

  if v_model = '' then
    -- No unit to draft; drop a draft made for a model that was cleared.
    delete from public.stock_movements where install_plan_id = new.id and status = 'pending';
    return new;
  end if;

  select id into v_product_id
    from public.products
    where trim(sku) = trim(split_part(v_model, ' / ', 1))
    order by date_added
    limit 1;

  if v_existing.id is null then
    insert into public.stock_movements (
      date, product_id, item_label, quantity_added, quantity_removed,
      reason, user_id, reference_number, install_plan_id, status
    )
    values (
      coalesce(v_date, current_date),
      v_product_id,
      v_model,
      0,
      1,
      'Installation',
      auth.uid(),
      coalesce(nullif(new.order_no, ''), new.id::text),
      new.id,
      'pending'
    );
  elsif v_existing.status = 'pending' then
    update public.stock_movements
      set date = coalesce(v_date, date),
        item_label = v_model,
        -- keep an admin's own mapping unless the model itself changed
        product_id = case
          when TG_OP = 'UPDATE' and trim(coalesce(old.model, '')) = v_model then coalesce(product_id, v_product_id)
          else v_product_id
        end,
        reference_number = coalesce(nullif(new.order_no, ''), reference_number)
      where id = v_existing.id and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_queue_install_inventory on public.install_plans;
create trigger trg_queue_install_inventory
  after insert or update of model, installed_date, pre_installed_date, input_date, order_no on public.install_plans
  for each row execute function public.queue_install_inventory();

-- A deleted install takes its still-pending draft with it (the foreign key
-- alone would only null install_plan_id and leave an orphan in the queue).
create or replace function public.remove_install_inventory_draft()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.stock_movements where install_plan_id = old.id and status = 'pending';
  return old;
end;
$$;

drop trigger if exists trg_remove_install_inventory_draft on public.install_plans;
create trigger trg_remove_install_inventory_draft
  before delete on public.install_plans
  for each row execute function public.remove_install_inventory_draft();
