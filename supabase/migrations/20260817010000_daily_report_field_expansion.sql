-- Expands the daily-report plan tables to match the fields/columns of the old
-- AppSheet forms and views (Filter Change Plan expanded view, Install's
-- SalesSchedulePlan form, Repair Plan form, Collection Plan columns), and adds
-- a technician remarks field to schedule_jobs captured when a job is marked Done.

alter table public.filter_change_plans
  add column contact_number text not null default '',
  add column address text not null default '',
  add column s_c text not null default '',
  add column product_no text not null default '',
  add column pre_d date,
  add column acc_d date,
  add column serviceman text not null default '',
  add column note text;

alter table public.install_plans
  add column contact_number text not null default '',
  add column model text not null default '',
  add column unit_price numeric(12, 2) not null default 0,
  add column cp_price numeric(12, 2) not null default 0,
  add column delivery_installation_fee numeric(12, 2) not null default 0,
  add column pre_installed_date date,
  add column installed_date date,
  add column note text,
  add column model_dp text,
  add column in_out text not null default 'IN';

alter table public.repair_plans
  add column problem text not null default '',
  add column solution_status text,
  add column pre_d date,
  add column acc_d date,
  add column th text not null default '',
  add column part_no text,
  add column amt numeric(12, 2) not null default 0,
  add column unit_in_out text not null default 'In';

alter table public.collections
  add column c_t text not null default '',
  add column pre_d date,
  add column acc_d date,
  add column note text;

alter table public.schedule_jobs
  add column remarks text;
