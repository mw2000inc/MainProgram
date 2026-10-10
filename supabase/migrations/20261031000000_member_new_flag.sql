-- A "new" flag on members, shared by all admins: a member created in the app
-- shows green on the Member list until an admin marks it as seen.
--
-- 1. The column is added with default FALSE, so every existing member (228
--    on Oct 10, 2026) starts with the flag OFF — none of them turns green.
-- 2. The default then becomes TRUE, so every member created from now on
--    starts with the flag ON. Members are only created through the app's
--    createCustomer (the Add Member form, and the Install form when it adds a
--    member), so both are flagged without the app sending anything — and the
--    app keeps working whether this migration or the new app code goes live
--    first.
-- 3. "Mark as seen" / "Mark all as seen" set it back to false (admins only:
--    customers_update_admin already limits updates to admins).
-- 4. Realtime: customers joins the supabase_realtime publication, so a
--    "Mark as seen" reaches every admin's open Member list straight away.
--    postgres_changes respects RLS — technicians can't read members, so they
--    receive nothing.
--
-- Safe to re-run: the column is only added once (existing rows keep their
-- value), and the publication step skips a table already in it. Changes no
-- existing row's other data.

alter table public.customers add column if not exists is_new boolean not null default false;
alter table public.customers alter column is_new set default true;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
     ) then
    alter publication supabase_realtime add table public.customers;
  end if;
end;
$$;
