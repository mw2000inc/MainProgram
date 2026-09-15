-- repair_plans has never had an Address column — the form only ever
-- collected Account Name, with the comment on its own NoteCell/lookup
-- handlers explicitly noting "Repair has no contact/address columns."
-- Adding one now for real customer-detail autofill parity with Install/
-- Filter Change. Nullable, no default, matching every other optional
-- string column already on this table (solution_status, part_no).
alter table public.repair_plans
  add column if not exists address text;
