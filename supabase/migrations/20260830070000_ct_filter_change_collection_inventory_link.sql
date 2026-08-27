-- Connects C/T (schedule_jobs) completion to Filter Change, Collection, and
-- Inventory automatically, so an admin never has to re-enter the same
-- filter-change requirement three times. Data flow:
--
--   schedule_jobs (existing) --filter items recorded--> schedule_job_filter_items (NEW)
--     --finds-or-creates, once, via schedule_job_id--> filter_change_plans / collections
--     --always--> stock_movements, inserted status='pending' (no stock effect yet)
--                   --admin approves--> status='approved' --trigger--> products.stock_quantity actually decrements
--
-- Nothing existing is dropped or renamed: filter_change_plans/collections
-- keep every current column and their existing free-text-only manual
-- workflow (source defaults to 'manual'); stock_movements defaults status to
-- 'approved' so every other write path (manual entries, the sale-item
-- trigger, the old filter-change cron) behaves exactly as it did before this
-- migration.

-- =========================================================================
-- 1. schedule_job_filter_items — the single source of truth for "which
--    filters, how many" a completed job requires. filter_change_plans and
--    collections link to a job via schedule_job_id and read this table live
--    rather than keeping their own copy, so there is exactly one place this
--    list can ever live (avoids duplicating the same data three times).
-- =========================================================================
create table public.schedule_job_filter_items (
  id uuid primary key default gen_random_uuid(),
  schedule_job_id uuid not null references public.schedule_jobs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.schedule_job_filter_items enable row level security;

-- Same read-open shape as every other Daily Report plan table.
create policy "schedule_job_filter_items_select" on public.schedule_job_filter_items
  for select to authenticated using (true);

-- An admin can always record filter items for any job; a technician only for
-- a job they're actually assigned to (mirrors schedule_jobs_update from the
-- technician_job_status_update migration) — the same narrow write access
-- already granted for marking status/remarks extends naturally to "what
-- filters did this job need".
create policy "schedule_job_filter_items_insert" on public.schedule_job_filter_items
  for insert to authenticated with check (
    public.is_admin()
    or exists (
      select 1 from public.schedule_jobs j
      where j.id = schedule_job_id
        and (j.technician_user_id = auth.uid() or j.technician_2_user_id = auth.uid())
    )
  );

-- Editing/removing an already-recorded item (as opposed to recording it in
-- the first place) is an admin action, same as every other correction made
-- after the fact in this app.
create policy "schedule_job_filter_items_update_admin" on public.schedule_job_filter_items
  for update to authenticated using (public.is_admin());
create policy "schedule_job_filter_items_delete_admin" on public.schedule_job_filter_items
  for delete to authenticated using (public.is_admin());

drop trigger if exists trg_audit_columns on public.schedule_job_filter_items;
create trigger trg_audit_columns before insert or update on public.schedule_job_filter_items
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.schedule_job_filter_items;
create trigger trg_audit_log after insert or update or delete on public.schedule_job_filter_items
  for each row execute function public.log_audit_event();

-- =========================================================================
-- 2. Link filter_change_plans / collections back to the real customer + job
--    they're for, instead of only a free-text account/order number, and
--    tag how each row came to exist.
-- =========================================================================
alter table public.filter_change_plans
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists schedule_job_id uuid references public.schedule_jobs(id) on delete set null,
  add column if not exists source text not null default 'manual' check (source in ('manual', 'ct_completion'));

-- At most one filter_change_plans row per job — the "find, don't duplicate"
-- rule enforced at the database level, not just in application code.
create unique index if not exists filter_change_plans_schedule_job_id_key
  on public.filter_change_plans (schedule_job_id) where schedule_job_id is not null;

alter table public.collections
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists schedule_job_id uuid references public.schedule_jobs(id) on delete set null,
  add column if not exists source text not null default 'manual' check (source in ('manual', 'ct_completion')),
  add column if not exists filter_change_required boolean not null default false;

create unique index if not exists collections_schedule_job_id_key
  on public.collections (schedule_job_id) where schedule_job_id is not null;

-- =========================================================================
-- 3. stock_movements gets a real pending/approved state. Inserting a row has
--    always immediately applied its quantity to products.stock_quantity
--    (see apply_stock_movement() below); every write path that already
--    exists (manual entries, the sale-item trigger, the old filter-change
--    cron) needs that to keep working exactly as before, so 'approved' is
--    the default and the only status any of those paths ever use.
-- =========================================================================
alter table public.stock_movements
  add column if not exists status text not null default 'approved' check (status in ('pending', 'approved')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null;

-- Only applies the product-quantity effect for an approved row — a pending
-- one is a real, visible ledger entry with zero actual stock effect until an
-- admin approves it.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_qty integer;
  v_min integer;
  v_name text;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  update public.products
    set stock_quantity = stock_quantity + new.quantity_added - new.quantity_removed,
        last_updated = new.date
    where id = new.product_id
    returning stock_quantity, min_stock_level, name into v_qty, v_min, v_name;

  if v_qty <= 0 then
    insert into public.notifications (type, message, related_entity_id)
    values ('out-of-stock', v_name || ' is out of stock.', new.product_id::text);
  elsif v_qty <= v_min then
    insert into public.notifications (type, message, related_entity_id)
    values ('low-stock', v_name || ' is running low (' || v_qty || ' left).', new.product_id::text);
  end if;

  return new;
end;
$$;

-- Fires specifically on the pending -> approved transition — applies the
-- FULL quantity (not a diff from the old row, unlike
-- apply_stock_movement_update() below) since a pending row's quantity was
-- never applied to product stock in the first place.
create or replace function public.apply_stock_movement_approval()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_qty integer;
  v_min integer;
  v_name text;
begin
  update public.products
    set stock_quantity = stock_quantity + new.quantity_added - new.quantity_removed,
        last_updated = new.date
    where id = new.product_id
    returning stock_quantity, min_stock_level, name into v_qty, v_min, v_name;

  if v_qty <= 0 then
    insert into public.notifications (type, message, related_entity_id)
    values ('out-of-stock', v_name || ' is out of stock.', new.product_id::text);
  elsif v_qty <= v_min then
    insert into public.notifications (type, message, related_entity_id)
    values ('low-stock', v_name || ' is running low (' || v_qty || ' left).', new.product_id::text);
  end if;

  return new;
end;
$$;

drop trigger if exists stock_movement_approved on public.stock_movements;
create trigger stock_movement_approved
  after update on public.stock_movements
  for each row
  when (old.status = 'pending' and new.status = 'approved')
  execute function public.apply_stock_movement_approval();

-- apply_stock_movement_update() (the existing quantity-edit trigger) assumes
-- the OLD row's quantities were already applied to product stock — true for
-- every approved row, never true for a pending one. Guard it so editing a
-- still-pending row's quantities doesn't touch stock at all (nothing to
-- correct yet); the approval trigger above applies the final quantities in
-- one step regardless of how many edits happened while pending.
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
begin
  if new.status <> 'approved' or old.status <> 'approved' then
    return new;
  end if;

  v_delta := (new.quantity_added - new.quantity_removed) - (old.quantity_added - old.quantity_removed);

  update public.products
    set stock_quantity = stock_quantity + v_delta,
        last_updated = new.date
    where id = new.product_id
    returning stock_quantity, min_stock_level, name into v_qty, v_min, v_name;

  if v_qty <= 0 then
    insert into public.notifications (type, message, related_entity_id)
    values ('out-of-stock', v_name || ' is out of stock.', new.product_id::text);
  elsif v_qty <= v_min then
    insert into public.notifications (type, message, related_entity_id)
    values ('low-stock', v_name || ' is running low (' || v_qty || ' left).', new.product_id::text);
  end if;

  return new;
end;
$$;

-- reverse_stock_movement() (the delete trigger) makes the same assumption —
-- guard it the same way, so deleting a still-pending row (e.g. an admin
-- rejecting it outright) doesn't touch stock either.
create or replace function public.reverse_stock_movement()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.status = 'approved' then
    update public.products
      set stock_quantity = stock_quantity - (old.quantity_added - old.quantity_removed)
      where id = old.product_id;
  end if;
  return old;
end;
$$;

-- =========================================================================
-- 4. The propagation trigger: recording a filter item for a job creates or
--    reuses (never duplicates) that job's Filter Change and Collection
--    records, and always inserts its own pending stock movement.
-- =========================================================================
create or replace function public.handle_schedule_job_filter_item()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_customer_id uuid;
  v_job_order_no text;
  v_job_technician text;
  v_job_scheduled_date date;
  -- Plain scalars, not a %rowtype/record — a record variable that's never
  -- populated (a job with no linked customer skips the lookup below) throws
  -- "record is not assigned yet" the moment any of its fields are read, so
  -- individual variables (naturally NULL until set) are the safe choice here.
  v_customer_full_name text;
  v_customer_company_name text;
  v_customer_member_account_number text;
  v_customer_address text;
  v_customer_contact_number text;
  v_filter_summary text;
  v_existing_movement uuid;
begin
  select customer_id, order_no, technician, scheduled_date
    into v_job_customer_id, v_job_order_no, v_job_technician, v_job_scheduled_date
    from public.schedule_jobs where id = new.schedule_job_id;

  if v_job_customer_id is not null then
    select full_name, company_name, member_account_number, address, contact_number
      into v_customer_full_name, v_customer_company_name, v_customer_member_account_number,
        v_customer_address, v_customer_contact_number
      from public.customers where id = v_job_customer_id;
  end if;

  -- Every filter currently recorded for this job, product names joined for
  -- the existing single-text filter_type column — refreshed on every new
  -- item so filter_change_plans always shows the current full list without
  -- storing its own separate copy of it.
  select string_agg(p.name || ' x' || i.quantity, ', ' order by p.name)
    into v_filter_summary
    from public.schedule_job_filter_items i
    join public.products p on p.id = i.product_id
    where i.schedule_job_id = new.schedule_job_id;

  insert into public.filter_change_plans (
    order_number, member_account, filter_type, plan_date, status,
    contact_number, address, serviceman, customer_id, schedule_job_id, source
  )
  values (
    coalesce(v_job_order_no, ''),
    coalesce(v_customer_member_account_number, ''),
    coalesce(v_filter_summary, ''),
    coalesce(v_job_scheduled_date, current_date),
    'Pending',
    coalesce(v_customer_contact_number, ''),
    coalesce(v_customer_address, ''),
    coalesce(v_job_technician, ''),
    v_job_customer_id,
    new.schedule_job_id,
    'ct_completion'
  )
  on conflict (schedule_job_id) where schedule_job_id is not null
  do update set filter_type = excluded.filter_type;

  insert into public.collections (
    order_no, account_name, collection_date, status,
    customer_id, schedule_job_id, source, filter_change_required
  )
  values (
    coalesce(v_job_order_no, ''),
    coalesce(nullif(v_customer_company_name, ''), v_customer_full_name, ''),
    coalesce(v_job_scheduled_date, current_date),
    'Pending',
    v_job_customer_id,
    new.schedule_job_id,
    'ct_completion',
    true
  )
  on conflict (schedule_job_id) where schedule_job_id is not null
  do update set filter_change_required = true;

  -- One pending stock movement per filter item — idempotent per (job,
  -- product): re-recording the same item (e.g. a retried submission) never
  -- creates a second pending transaction for it.
  select id into v_existing_movement
    from public.stock_movements
    where schedule_job_id = new.schedule_job_id and product_id = new.product_id
    limit 1;

  if v_existing_movement is null then
    insert into public.stock_movements (
      date, product_id, quantity_added, quantity_removed,
      reason, user_id, reference_number, schedule_job_id, status
    )
    values (
      coalesce(v_job_scheduled_date, current_date),
      new.product_id,
      0,
      new.quantity,
      'Filter Change',
      auth.uid(),
      coalesce(v_job_order_no, new.schedule_job_id::text),
      new.schedule_job_id,
      'pending'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_schedule_job_filter_item on public.schedule_job_filter_items;
create trigger trg_schedule_job_filter_item
  after insert on public.schedule_job_filter_items
  for each row execute function public.handle_schedule_job_filter_item();

-- =========================================================================
-- 5. Admin activity: entity-type label + description case for the Admin/
--    Technician Activity pages, matching every other instrumented table.
--    Rebuilt from the CURRENT (post 20260830050000-fix) definition — that
--    migration's extra user_id fallback and its own narrower exception
--    block around the insert must both be preserved here, or this replace
--    would silently re-regress the signup bug that fix resolved.
-- =========================================================================
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_full_old jsonb;
  v_full_new jsonb;
  v_diff_old jsonb := '{}'::jsonb;
  v_diff_new jsonb := '{}'::jsonb;
  v_entity_id text;
  v_description text;
  v_user_id uuid;
begin
  begin

  if TG_OP in ('UPDATE', 'DELETE') then
    v_full_old := to_jsonb(OLD);
  end if;
  if TG_OP in ('INSERT', 'UPDATE') then
    v_full_new := to_jsonb(NEW);
  end if;

  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into v_diff_old
      from jsonb_each(v_full_old) o join jsonb_each(v_full_new) n on o.key = n.key
      where o.value is distinct from n.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into v_diff_new
      from jsonb_each(v_full_new) n join jsonb_each(v_full_old) o on o.key = n.key
      where o.value is distinct from n.value;
    if v_diff_new = '{}'::jsonb then
      return NEW;
    end if;
  elsif TG_OP = 'INSERT' then
    v_diff_new := v_full_new;
  elsif TG_OP = 'DELETE' then
    v_diff_old := v_full_old;
  end if;

  v_entity_id := coalesce(v_full_new ->> 'id', v_full_old ->> 'id', v_full_new ->> 'section_key', v_full_old ->> 'section_key');

  v_description := case TG_TABLE_NAME
    when 'customers' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'company_name', ''), coalesce(v_full_new, v_full_old) ->> 'full_name')
    when 'sales' then coalesce(v_full_new, v_full_old) ->> 'invoice_number'
    when 'schedule_jobs' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'order_no', ''), 'Schedule Job')
    when 'install_plans' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'order_no', ''), coalesce(v_full_new, v_full_old) ->> 'name')
    when 'filter_change_plans' then coalesce(v_full_new, v_full_old) ->> 'order_number'
    when 'collections' then coalesce(v_full_new, v_full_old) ->> 'order_no'
    when 'repair_plans' then coalesce(v_full_new, v_full_old) ->> 'order_no'
    when 'products' then coalesce(nullif(coalesce(v_full_new, v_full_old) ->> 'name', ''), coalesce(v_full_new, v_full_old) ->> 'sku')
    when 'suppliers' then coalesce(v_full_new, v_full_old) ->> 'name'
    when 'stock_movements' then 'Stock Movement'
    when 'company_settings' then 'Company Settings'
    when 'announcements' then coalesce(v_full_new, v_full_old) ->> 'title'
    when 'profiles' then coalesce(v_full_new, v_full_old) ->> 'name'
    when 'daily_report_sections' then coalesce(v_full_new, v_full_old) ->> 'label'
    when 'sale_list_entries' then coalesce(v_full_new, v_full_old) ->> 'order_number'
    when 'cp_systems' then coalesce(v_full_new, v_full_old) ->> 'system_code'
    when 'schedule_job_filter_items' then 'Filter Item'
    else TG_TABLE_NAME
  end;

  -- Same three-level fallback as the 20260830050000 fix: auth.uid() (the
  -- normal case), then updated_by (the admin-users route's service-role
  -- path, which has no auth.uid() of its own), then the row's own id (a
  -- public self-signup inserting its own profiles row, before any session
  -- exists at all) — so this never tries to write a null user_id and rely
  -- solely on the column being nullable.
  v_user_id := coalesce(
    auth.uid(),
    (coalesce(v_full_new, v_full_old) ->> 'updated_by')::uuid,
    (coalesce(v_full_new, v_full_old) ->> 'id')::uuid
  );

  begin
    insert into public.activity_logs (user_id, action, entity_type, entity_id, description, old_values, new_values, date, time)
    values (
      v_user_id,
      lower(TG_OP),
      TG_TABLE_NAME,
      v_entity_id,
      v_description,
      v_diff_old,
      v_diff_new,
      (now() at time zone 'utc')::date,
      to_char(now() at time zone 'utc', 'HH24:MI')
    );
  exception when others then
    null; -- narrower safety net directly around the insert itself
  end;

  exception when others then
    null; -- swallow — see the comment above this nested block
  end;

  return coalesce(NEW, OLD);
end;
$$;
