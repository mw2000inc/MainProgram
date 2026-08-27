-- System-wide admin activity/audit tracking.
--
-- This app has no general server-side API layer — almost every write
-- (customers, sales, schedule_jobs, the daily-report plan tables, products,
-- announcements, profiles, etc.) goes straight from the browser to Supabase
-- via the anon-key client (see src/lib/api/*.ts). That rules out an
-- application-code "call logAdminAction() before every save" approach: it
-- would mean rewriting every mutation across ~15 files, and — critically —
-- a client-supplied user id is exactly the kind of value the security
-- requirement says never to trust (a crafted request could omit the call or
-- pass someone else's id). The only value that can't be spoofed here is
-- auth.uid(), populated by Supabase from the verified JWT — the same value
-- public.is_admin() already trusts everywhere in this app's RLS. So both
-- created_by/updated_by and the audit trail itself are set by triggers that
-- read auth.uid() directly at the database layer, not by any application
-- code — this can't be bypassed by any client, present or future, no matter
-- how a write reaches these tables.
--
-- This upgrades the existing public.activity_logs table (added in the
-- initial schema, used by the old logActivity() helper) rather than
-- creating a second, redundant audit_logs table — same purpose, just
-- missing entity_type/entity_id/before-after values and, more importantly,
-- missing any real enforcement: its old RLS let any authenticated user read
-- every entry and insert an arbitrary user_id. Both are fixed below.

-- =========================================================================
-- 1. Upgrade activity_logs and lock it down
-- =========================================================================

alter table public.activity_logs
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists description text,
  add column if not exists old_values jsonb,
  add column if not exists new_values jsonb,
  add column if not exists created_at timestamptz not null default now();

-- Relaxed from not null: log_audit_event() below falls back through several
-- values before landing on auth.uid(), and an audit entry that ends up with
-- no attributable user in some edge case not yet anticipated must never be
-- able to fail its INSERT — that would roll back the AFTER trigger and, with
-- it, the real data write that triggered it. A rare null user_id row is a
-- far smaller problem than an audit trigger that can block legitimate
-- business writes.
alter table public.activity_logs alter column user_id drop not null;

drop policy if exists "activity_logs_select" on public.activity_logs;
drop policy if exists "activity_logs_write" on public.activity_logs;

-- Admin-only read — a technician must not be able to see the full activity
-- log (per the stated requirement), let alone another admin's actions.
create policy "activity_logs_select_admin" on public.activity_logs
  for select to authenticated using (public.is_admin());

-- Deliberately no insert/update/delete policy for the authenticated role at
-- all, for anyone, admin included: the only way a row is ever written is
-- through log_audit_event() below, a SECURITY DEFINER function that bypasses
-- RLS the same way handle_new_user() and get_portal_profile() already do
-- elsewhere in this schema. Nobody can edit or delete audit history, and
-- nobody can insert a fabricated entry directly.

-- =========================================================================
-- 2. Trigger functions
-- =========================================================================

-- Sets created_by/updated_by/updated_at from the authenticated session on
-- every insert/update of an instrumented table — never from a client-
-- supplied value for any normal, RLS-gated write (every one of these
-- tables' policies require `to authenticated`, so if a write got past RLS
-- at all, auth.uid() is guaranteed non-null, and this unconditionally
-- overwrites anything a crafted request tried to set for these columns
-- itself — a BEFORE trigger's NEW assignment always wins over whatever the
-- INSERT/UPDATE statement supplied).
--
-- coalesce(auth.uid(), new.<col>) exists for exactly one legitimate
-- exception: src/app/api/admin/users/route.ts creates technician/admin
-- accounts via the service-role key (required for setting a password),
-- which has no browser session and so no auth.uid() at all. That route
-- already independently verifies the calling admin's own session server-side
-- before doing anything, then explicitly sets created_by/updated_by to that
-- verified id in its own follow-up update — a real, server-verified value,
-- just sourced differently than auth.uid(). Falling back to it only when
-- auth.uid() is null can't be exploited by an ordinary authenticated client:
-- that path requires the service-role key, which is never exposed to the
-- browser.
create or replace function public.set_audit_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  elsif TG_OP = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- One centralized audit-logging function, attached to every instrumented
-- table below, instead of duplicating logging code per table or per
-- src/lib/api/*.ts call site. Records who (auth.uid()), what (entity_type =
-- the table name, entity_id, a human-readable description, and old/new
-- values trimmed to just the columns that actually changed — not the whole
-- row, to keep entries small and avoid noise from untouched columns), and
-- when (this row's own created_at). Uses to_jsonb()/->> throughout instead
-- of NEW.<column> so it works generically across tables with different
-- shapes (e.g. daily_report_sections has no `id` column at all, only
-- section_key) without erroring or needing a per-table trigger function.
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
begin
  -- Everything below is best-effort: an audit-logging bug must never be able
  -- to block or roll back the real data write that triggered it (an AFTER
  -- trigger's exception fails the whole original statement otherwise). Any
  -- unexpected error here is swallowed and the write proceeds unaudited
  -- rather than failing.
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
    -- Nothing actually changed (e.g. a form saved with no real edits) —
    -- skip logging noise rather than writing an empty-diff entry.
    if v_diff_new = '{}'::jsonb then
      return NEW;
    end if;
  elsif TG_OP = 'INSERT' then
    v_diff_new := v_full_new;
  elsif TG_OP = 'DELETE' then
    v_diff_old := v_full_old;
  end if;

  v_entity_id := coalesce(v_full_new ->> 'id', v_full_old ->> 'id', v_full_new ->> 'section_key', v_full_old ->> 'section_key');

  -- A short, human-readable label for the "Record" column of the Admin
  -- Activity page — pulled from the FULL row (not the diff above), since an
  -- update to an unrelated field shouldn't make the record unidentifiable.
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
    else TG_TABLE_NAME
  end;

  -- Same coalesce fallback as set_audit_columns(), and for the same reason
  -- (the admin-users route's service-role follow-up update) — by the time
  -- this AFTER trigger runs, NEW.updated_by has already been set correctly
  -- by that BEFORE trigger, so falling back to it here keeps the audit
  -- entry attributed to the right admin instead of showing user_id null.
  insert into public.activity_logs (user_id, action, entity_type, entity_id, description, old_values, new_values, date, time)
  values (
    coalesce(auth.uid(), (coalesce(v_full_new, v_full_old) ->> 'updated_by')::uuid),
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
    null; -- swallow — see the comment above this nested block
  end;

  return coalesce(NEW, OLD);
end;
$$;

-- =========================================================================
-- 3. Instrument every important admin-managed table
-- =========================================================================
-- created_at is added defensively (if not exists) even where it should
-- already be present, since set_audit_columns() reads/preserves it on
-- update and a couple of tables (suppliers, sales, stock_movements,
-- company_settings) predate that column existing at all.

-- ---------- customers ----------
alter table public.customers
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.customers;
create trigger trg_audit_columns before insert or update on public.customers
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.customers;
create trigger trg_audit_log after insert or update or delete on public.customers
  for each row execute function public.log_audit_event();

-- ---------- sales ----------
alter table public.sales
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.sales;
create trigger trg_audit_columns before insert or update on public.sales
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.sales;
create trigger trg_audit_log after insert or update or delete on public.sales
  for each row execute function public.log_audit_event();

-- ---------- schedule_jobs ----------
alter table public.schedule_jobs
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.schedule_jobs;
create trigger trg_audit_columns before insert or update on public.schedule_jobs
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.schedule_jobs;
create trigger trg_audit_log after insert or update or delete on public.schedule_jobs
  for each row execute function public.log_audit_event();

-- ---------- install_plans ----------
alter table public.install_plans
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.install_plans;
create trigger trg_audit_columns before insert or update on public.install_plans
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.install_plans;
create trigger trg_audit_log after insert or update or delete on public.install_plans
  for each row execute function public.log_audit_event();

-- ---------- filter_change_plans ----------
alter table public.filter_change_plans
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.filter_change_plans;
create trigger trg_audit_columns before insert or update on public.filter_change_plans
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.filter_change_plans;
create trigger trg_audit_log after insert or update or delete on public.filter_change_plans
  for each row execute function public.log_audit_event();

-- ---------- collections ----------
alter table public.collections
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.collections;
create trigger trg_audit_columns before insert or update on public.collections
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.collections;
create trigger trg_audit_log after insert or update or delete on public.collections
  for each row execute function public.log_audit_event();

-- ---------- repair_plans ----------
alter table public.repair_plans
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.repair_plans;
create trigger trg_audit_columns before insert or update on public.repair_plans
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.repair_plans;
create trigger trg_audit_log after insert or update or delete on public.repair_plans
  for each row execute function public.log_audit_event();

-- ---------- products ----------
alter table public.products
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.products;
create trigger trg_audit_columns before insert or update on public.products
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.products;
create trigger trg_audit_log after insert or update or delete on public.products
  for each row execute function public.log_audit_event();

-- ---------- suppliers ----------
alter table public.suppliers
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.suppliers;
create trigger trg_audit_columns before insert or update on public.suppliers
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.suppliers;
create trigger trg_audit_log after insert or update or delete on public.suppliers
  for each row execute function public.log_audit_event();

-- ---------- stock_movements ----------
alter table public.stock_movements
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.stock_movements;
create trigger trg_audit_columns before insert or update on public.stock_movements
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.stock_movements;
create trigger trg_audit_log after insert or update or delete on public.stock_movements
  for each row execute function public.log_audit_event();

-- ---------- company_settings ----------
alter table public.company_settings
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.company_settings;
create trigger trg_audit_columns before insert or update on public.company_settings
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.company_settings;
create trigger trg_audit_log after insert or update or delete on public.company_settings
  for each row execute function public.log_audit_event();

-- ---------- announcements ----------
alter table public.announcements
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.announcements;
create trigger trg_audit_columns before insert or update on public.announcements
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.announcements;
create trigger trg_audit_log after insert or update or delete on public.announcements
  for each row execute function public.log_audit_event();

-- ---------- profiles (Users / Admin management) ----------
alter table public.profiles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.profiles;
create trigger trg_audit_columns before insert or update on public.profiles
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.profiles;
create trigger trg_audit_log after insert or update or delete on public.profiles
  for each row execute function public.log_audit_event();

-- ---------- daily_report_sections ----------
alter table public.daily_report_sections
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.daily_report_sections;
create trigger trg_audit_columns before insert or update on public.daily_report_sections
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.daily_report_sections;
create trigger trg_audit_log after insert or update or delete on public.daily_report_sections
  for each row execute function public.log_audit_event();

-- ---------- sale_list_entries ----------
alter table public.sale_list_entries
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.sale_list_entries;
create trigger trg_audit_columns before insert or update on public.sale_list_entries
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.sale_list_entries;
create trigger trg_audit_log after insert or update or delete on public.sale_list_entries
  for each row execute function public.log_audit_event();

-- ---------- cp_systems ----------
alter table public.cp_systems
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;
drop trigger if exists trg_audit_columns on public.cp_systems;
create trigger trg_audit_columns before insert or update on public.cp_systems
  for each row execute function public.set_audit_columns();
drop trigger if exists trg_audit_log on public.cp_systems;
create trigger trg_audit_log after insert or update or delete on public.cp_systems
  for each row execute function public.log_audit_event();
