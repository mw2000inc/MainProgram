-- Collection Details breakdown dialog (All Collection view's own "Collection
-- Details" trigger badge, next to the Collected/Not Collected summary
-- badges) — a dedicated cash/cheque reconciliation table matching an
-- existing external spreadsheet the admin already tracks this in.
--
-- Collections-only, not Install/Repair: description/cheque_details/
-- deposited_date/deposited_fund model a "how was this payment actually
-- received, and where did it end up" workflow that has no equivalent
-- anywhere on install_plans or repair_plans, and the breakdown's own single
-- "Amount" column only cleanly maps to collections.amount — Install/Repair
-- each split their own amount across three separate sub-fields (Unit
-- Price/C-P Price/Delivery Fee) instead, with no single number to show in
-- its place.
--
-- Mode of Payment reuses the EXISTING payment_type column (added by
-- 20261001000000_collection_payment_type.sql) rather than a new field —
-- it's already editable elsewhere in the All Collection table with a
-- 5-value roster (GCash/Card/Bank/Cash/Check, see COLLECTION_PAYMENT_TYPES
-- in constants.ts), a superset of the 3 values requested for this dialog.
-- A second, narrower "payment mode" field on the same table would risk
-- silently drifting out of sync with the one every other view already reads
-- and edits.
alter table public.collections
  add column if not exists description text not null default '',
  add column if not exists cheque_details text not null default '',
  add column if not exists deposited_date date,
  add column if not exists deposited_fund text not null default '';

-- '' means "not yet categorized" (this column's own default, same
-- not-null-default-empty convention every other free-text column on this
-- table already uses) — not itself one of the five real fund destinations.
alter table public.collections drop constraint if exists collections_deposited_fund_check;
alter table public.collections
  add constraint collections_deposited_fund_check check (deposited_fund in ('', 'COH', 'GCash', 'MB', 'EW', 'BDO'));
