-- Lets a repair's "Part No" line item name a part that isn't (yet) in the
-- products catalog. The Add Part dialog's Part/Part No fields are typable
-- comboboxes (see repair-parts-section.tsx) — until now, typing something
-- that didn't exactly resolve to a real catalog product just left the Add
-- button disabled, since product_id was NOT NULL with no other way to
-- record what was typed.
--
-- product_id stays the source of truth whenever a real catalog product
-- actually resolves — this only relaxes "must always be a real product,"
-- it doesn't weaken the FK itself (still on delete restrict, still checked
-- whenever it's set). custom_part_no/custom_part_name hold the free-typed
-- value for the one-off case where there's no matching product; exactly
-- one of (product_id) or (custom_part_no/custom_part_name) is meaningful
-- per row, enforced by the check constraint below so a row can never end
-- up identifying no part at all.
alter table public.repair_plan_parts
  alter column product_id drop not null,
  add column if not exists custom_part_no text,
  add column if not exists custom_part_name text;

alter table public.repair_plan_parts
  add constraint repair_plan_parts_identifies_a_part
    check (product_id is not null or custom_part_no is not null or custom_part_name is not null);
