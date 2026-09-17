-- "All Collection" cross-module payments view (Daily Report) needs to track
-- whether a given collection/install/repair record's money has actually
-- been collected -- separate from each table's own dispatch/visit status,
-- confirmed meaningless for this purpose (every live row across all three
-- tables is "Pending" regardless of whether money changed hands). Defaults
-- false; the app only ever flips it via an explicit admin action in the All
-- Collection dialog -- enforced server-side by the same admin-only UPDATE
-- policies these three tables already have (see
-- reassert_plan_tables_admin_write), no new RLS needed.
alter table public.collections
  add column if not exists collected boolean not null default false;

alter table public.install_plans
  add column if not exists collected boolean not null default false;

alter table public.repair_plans
  add column if not exists collected boolean not null default false;
