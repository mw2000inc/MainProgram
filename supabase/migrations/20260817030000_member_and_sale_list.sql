-- Customers -> "Member" relabel: adds the AppSheet Member List fields that don't
-- already exist. companyName/fullName are reused as Account Name/Contact Person
-- (relabeled in the UI only) rather than duplicated into new columns.
alter table public.customers
  add column member_account_number text not null default '',
  add column contact_number2 text not null default '',
  add column address2 text not null default '',
  add column email2 text not null default '',
  add column tin text not null default '';

-- "Sale List" — a new, distinct module (per-customer install/care-plan tracking:
-- Order Number, Product#, S/C, C/F, C/T, CP y1/y2, CP start/end, Status). This is
-- NOT the invoicing `sales`/`sale_items` tables, which keep their existing shape
-- and RLS untouched — the AppSheet "Sales List" screen doesn't correspond to a
-- point-of-sale invoice at all, it corresponds to this.
create table public.sale_list_entries (
  id uuid primary key default gen_random_uuid(),
  order_number text not null default '',
  installed_date date,
  customer_id uuid references public.customers(id) on delete set null,
  product_no text not null default '',
  s_c text not null default '',
  c_f text not null default '',
  c_t text not null default '',
  cp_y1_y2 text not null default '',
  cp_start date,
  cp_end date,
  note text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

alter table public.sale_list_entries enable row level security;

-- Matches the permissive pattern used by the other daily-report plan tables:
-- staff + admin can read/add/edit, admin-only delete.
create policy "sale_list_entries_select" on public.sale_list_entries for select to authenticated using (true);
create policy "sale_list_entries_write" on public.sale_list_entries for insert to authenticated with check (true);
create policy "sale_list_entries_update" on public.sale_list_entries for update to authenticated using (true);
create policy "sale_list_entries_delete_admin" on public.sale_list_entries for delete to authenticated using (public.is_admin());
