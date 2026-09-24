-- Gives each install its own Member Account#.
--
-- install_plans had no such column: the Install form's Member Account# field
-- was transient (only ever used to create a brand-new customer when the
-- Order No. matched nobody), so a typed value was dropped on save, never
-- shown when editing, and the detail card could only guess the member from
-- Order No./phone/name. Order No. is optional on installs, and none of the
-- live installs resolve to a customer by order, so the guess often found
-- nothing.
--
-- Stored the same way customers.member_account_number is (not null, '' when
-- unset). It is only a reference key to the member — there is deliberately no
-- foreign key, since that column is a plain text field on customers with a
-- partial unique index rather than a primary key. Existing rows stay '' and
-- keep resolving through the old inference until an admin sets one.
alter table public.install_plans
  add column if not exists member_account_number text not null default '';
