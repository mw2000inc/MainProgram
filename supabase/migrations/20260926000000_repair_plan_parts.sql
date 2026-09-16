-- Repair Plan's own related "Part No" line-items table (AppSheet parity) —
-- the Repair form there has an inline related list of parts used on that
-- specific repair visit (Part No, Part, In/Out, Qty), which this app never
-- had a backing table for. Distinct from repair_plans.part_no, the existing
-- single free-text summary field on the repair record itself — kept as-is,
-- untouched, since it may still hold a legacy value on old rows; this table
-- is purely additive.
--
-- Keyed by repair_plan_id, not order_no: a single order_no can have several
-- repair_plans rows (repeat visits for the same order, each its own record
-- with its own issued_date), and parts must stay scoped to the exact visit
-- they were used on rather than bleeding across every repair ever logged
-- for that order.
--
-- product_id references the real products catalog (same shape as
-- schedule_job_filter_items.product_id from the
-- ct_filter_change_collection_inventory_link migration) rather than
-- duplicating a free-text part number/name here — "Part No" and "Part" are
-- read live off products.sku/products.name at query time, so a later
-- rename in the catalog is reflected on every past repair's parts list too.
create table public.repair_plan_parts (
  id uuid primary key default gen_random_uuid(),
  repair_plan_id uuid not null references public.repair_plans(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  in_out text not null check (in_out in ('IN', 'OUT')),
  quantity numeric(12, 2) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null
);

create index if not exists repair_plan_parts_repair_plan_id_idx
  on public.repair_plan_parts (repair_plan_id);

alter table public.repair_plan_parts enable row level security;

-- Same read-open shape as every other Daily Report plan table.
create policy "repair_plan_parts_select" on public.repair_plan_parts
  for select to authenticated using (true);

-- Matches repair_plans' own admin-only write policies exactly
-- (repair_plans_write_admin/_update_admin/_delete_admin, from the
-- technician_readonly_daily_report and reassert_plan_tables_admin_write
-- migrations) — a repair record's own fields are admin-only to edit, so the
-- parts used on it are too.
create policy "repair_plan_parts_write_admin" on public.repair_plan_parts
  for insert to authenticated with check (public.is_admin());
create policy "repair_plan_parts_update_admin" on public.repair_plan_parts
  for update to authenticated using (public.is_admin());
create policy "repair_plan_parts_delete_admin" on public.repair_plan_parts
  for delete to authenticated using (public.is_admin());

drop trigger if exists trg_audit_columns on public.repair_plan_parts;
create trigger trg_audit_columns before insert or update on public.repair_plan_parts
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.repair_plan_parts;
create trigger trg_audit_log after insert or update or delete on public.repair_plan_parts
  for each row execute function public.log_audit_event();
