-- Dashboard "Daily Report" redesign: Announcements (with threaded comments),
-- Schedule jobs, and the four daily-plan panels (Filter Change, Install, Repair,
-- Collection), mirroring the old AppSheet Daily Report screen.

-- ---------- Announcements ----------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.announcement_comments (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Schedule (technician daily job agenda) ----------
create type public.schedule_job_type as enum ('installation', 'filter_change', 'repair', 'collection', 'monitoring', 'other');
create type public.schedule_job_status as enum ('pending', 'completed', 'cancelled');

create table public.schedule_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type public.schedule_job_type not null default 'other',
  technician text not null default '',
  customer_id uuid references public.customers(id) on delete set null,
  order_no text,
  scheduled_date date not null default current_date,
  status public.schedule_job_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);

-- ---------- Filter Change Plan ----------
create table public.filter_change_plans (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  member_account text not null,
  filter_type text not null default '',
  plan_date date not null default current_date,
  status text not null default 'Pending',
  created_at timestamptz not null default now()
);

-- ---------- Install Plan ----------
create table public.install_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_no text not null,
  input_date date not null default current_date,
  address text not null default '',
  status text not null default 'Pending',
  created_at timestamptz not null default now()
);

-- ---------- Repair Plan ----------
create table public.repair_plans (
  id uuid primary key default gen_random_uuid(),
  issued_date date not null default current_date,
  account_name text not null,
  order_no text not null,
  status text not null default 'Pending',
  created_at timestamptz not null default now()
);

-- ---------- Collection Plan ----------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  order_no text not null,
  account_name text not null,
  collection_date date not null default current_date,
  amount numeric(12, 2) not null default 0,
  status text not null default 'Pending',
  created_at timestamptz not null default now()
);

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table public.announcements enable row level security;
alter table public.announcement_comments enable row level security;
alter table public.schedule_jobs enable row level security;
alter table public.filter_change_plans enable row level security;
alter table public.install_plans enable row level security;
alter table public.repair_plans enable row level security;
alter table public.collections enable row level security;

-- announcements: everyone reads; only admins create/edit/delete (technicians are read-only on the announcement itself)
create policy "announcements_select" on public.announcements for select to authenticated using (true);
create policy "announcements_write_admin" on public.announcements for insert to authenticated with check (public.is_admin());
create policy "announcements_update_admin" on public.announcements for update to authenticated using (public.is_admin());
create policy "announcements_delete_admin" on public.announcements for delete to authenticated using (public.is_admin());

-- announcement_comments: everyone reads and can add their own comment;
-- authors edit only their own comment; authors or admins (moderation) can delete any comment they're allowed to.
create policy "announcement_comments_select" on public.announcement_comments for select to authenticated using (true);
create policy "announcement_comments_write" on public.announcement_comments for insert to authenticated
  with check (author_id = auth.uid());
create policy "announcement_comments_update_self" on public.announcement_comments for update to authenticated
  using (author_id = auth.uid());
create policy "announcement_comments_delete_self_or_admin" on public.announcement_comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- schedule_jobs / the four plan tables: staff + admin can read/add/edit (matches the
-- customers/contracts permissive write pattern), admin-only delete.
create policy "schedule_jobs_select" on public.schedule_jobs for select to authenticated using (true);
create policy "schedule_jobs_write" on public.schedule_jobs for insert to authenticated with check (true);
create policy "schedule_jobs_update" on public.schedule_jobs for update to authenticated using (true);
create policy "schedule_jobs_delete_admin" on public.schedule_jobs for delete to authenticated using (public.is_admin());

create policy "filter_change_plans_select" on public.filter_change_plans for select to authenticated using (true);
create policy "filter_change_plans_write" on public.filter_change_plans for insert to authenticated with check (true);
create policy "filter_change_plans_update" on public.filter_change_plans for update to authenticated using (true);
create policy "filter_change_plans_delete_admin" on public.filter_change_plans for delete to authenticated using (public.is_admin());

create policy "install_plans_select" on public.install_plans for select to authenticated using (true);
create policy "install_plans_write" on public.install_plans for insert to authenticated with check (true);
create policy "install_plans_update" on public.install_plans for update to authenticated using (true);
create policy "install_plans_delete_admin" on public.install_plans for delete to authenticated using (public.is_admin());

create policy "repair_plans_select" on public.repair_plans for select to authenticated using (true);
create policy "repair_plans_write" on public.repair_plans for insert to authenticated with check (true);
create policy "repair_plans_update" on public.repair_plans for update to authenticated using (true);
create policy "repair_plans_delete_admin" on public.repair_plans for delete to authenticated using (public.is_admin());

create policy "collections_select" on public.collections for select to authenticated using (true);
create policy "collections_write" on public.collections for insert to authenticated with check (true);
create policy "collections_update" on public.collections for update to authenticated using (true);
create policy "collections_delete_admin" on public.collections for delete to authenticated using (public.is_admin());
