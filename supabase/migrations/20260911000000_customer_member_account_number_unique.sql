-- Prevents duplicate Member Account# — currently nothing at the database
-- layer stops two customers from being created with the same
-- member_account_number, and the Add Member form did no check either (see
-- the investigation this was scoped from). Two real duplicate pairs
-- existed live before this migration; confirmed cleaned up (deleted by the
-- admin directly) and re-verified zero remaining duplicates before writing
-- this.
--
-- Partial, not a plain column-level unique constraint (unlike
-- order_number's own `unique` in the init schema) — member_account_number
-- is `not null default ''`, and at least one existing customer row
-- genuinely has it blank. A plain unique constraint would treat every
-- blank row as a duplicate of every other blank row and block them all;
-- excluding '' lets any number of not-yet-assigned/blank rows coexist
-- while still enforcing uniqueness among every real value.
create unique index if not exists customers_member_account_number_unique_idx
  on public.customers (member_account_number)
  where member_account_number <> '';
