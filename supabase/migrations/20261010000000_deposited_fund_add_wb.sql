-- Adds 'WB' to the Collection Details breakdown dialog's "Deposited Fund"
-- roster (DEPOSITED_FUND_OPTIONS in constants.ts), alongside the existing
-- COH/GCash/MB/EW/BDO.
--
-- A NEW migration, not an edit to 20261009000000_collection_breakdown_fields.sql
-- — that migration is already applied on the live database, and Supabase
-- only ever runs each migration file once (tracked by filename); editing it
-- after the fact would change what the file says happened without actually
-- changing what the live database allows, and would silently diverge from
-- what a fresh environment replaying migration history from scratch would
-- get. Same drop-then-re-add pattern this codebase's own
-- collections_source_check constraint already uses for exactly this kind
-- of "add one more allowed value" change.
alter table public.collections drop constraint if exists collections_deposited_fund_check;
alter table public.collections
  add constraint collections_deposited_fund_check check (deposited_fund in ('', 'COH', 'GCash', 'MB', 'EW', 'BDO', 'WB'));
