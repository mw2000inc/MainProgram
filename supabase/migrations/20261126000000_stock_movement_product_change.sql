-- An item's product can be changed on the Inventory List (Edit), e.g. a
-- Filter Change item that went out as 012 really being 013 — without
-- touching the Filter Change itself.
--
-- apply_stock_movement_update() only knew quantity changes, always on the
-- movement's current product, and its trigger fired only on a quantity
-- change. Now, for an APPROVED movement whose product changes, the old
-- product gets its stock back (the old quantities undone) and the new one
-- takes the new quantities; a quantity-only change works as before. A
-- pending movement never touched stock, so nothing moves for it (it applies
-- to the new product when approved). An unmapped side (no product) is skipped.
--
-- Running this changes no rows: it redefines one function and its trigger.

create or replace function public.apply_stock_movement_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_qty integer;
  v_min integer;
  v_name text;
  v_delta integer;
  v_product uuid;
begin
  if new.status <> 'approved' or old.status <> 'approved' then
    return new;
  end if;

  if new.product_id is distinct from old.product_id then
    -- The old product gets back what this movement had done to it.
    if old.product_id is not null then
      update public.products
        set stock_quantity = stock_quantity - (old.quantity_added - old.quantity_removed),
            last_updated = new.date
        where id = old.product_id;
    end if;
    v_delta := new.quantity_added - new.quantity_removed;
  else
    v_delta := (new.quantity_added - new.quantity_removed) - (old.quantity_added - old.quantity_removed);
  end if;

  v_product := new.product_id;
  if v_product is null then
    return new;
  end if;

  update public.products
    set stock_quantity = stock_quantity + v_delta,
        last_updated = new.date
    where id = v_product
    returning stock_quantity, min_stock_level, name into v_qty, v_min, v_name;

  if v_qty <= 0 then
    insert into public.notifications (type, message, related_entity_id)
    values ('out-of-stock', v_name || ' is out of stock.', v_product::text);
  elsif v_qty <= v_min then
    insert into public.notifications (type, message, related_entity_id)
    values ('low-stock', v_name || ' is running low (' || v_qty || ' left).', v_product::text);
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movement_updated on public.stock_movements;
create trigger stock_movement_updated
  after update on public.stock_movements
  for each row
  when (
    old.quantity_added is distinct from new.quantity_added
    or old.quantity_removed is distinct from new.quantity_removed
    or old.product_id is distinct from new.product_id
  )
  execute function public.apply_stock_movement_update();
