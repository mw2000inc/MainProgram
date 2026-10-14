-- Corrects the waiting repair-part movements to the direction decided on
-- 2026-10-14 (20261106000000): a part marked OUT is deducted, IN is returned.
--
-- Why: 20261106000000's step 2 swapped every pending repair-part movement's
-- quantity added / removed unconditionally. Checked live after it ran: all 29
-- were updated at the same moment, yet 27 still followed the OLD direction —
-- consistent with the migration having been applied twice (two swaps cancel
-- out).
--
-- This version compares each movement with its own part's IN / OUT and fixes
-- only the ones that disagree, so running it again changes nothing. Only
-- PENDING movements from repair parts; approved / rejected rows are never
-- touched.

update public.stock_movements m
  set quantity_added = m.quantity_removed,
      quantity_removed = m.quantity_added
  from public.repair_plan_parts p
  where m.repair_plan_part_id = p.id
    and m.status = 'pending'
    and (
      (p.in_out = 'OUT' and m.quantity_added > 0 and m.quantity_removed = 0)
      or (p.in_out = 'IN' and m.quantity_removed > 0 and m.quantity_added = 0)
    );
