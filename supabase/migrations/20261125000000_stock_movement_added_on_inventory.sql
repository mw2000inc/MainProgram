-- Stock added on the Inventory pages (Inventory, In & Out Summary) is the
-- admin's own stock count: it's applied at once, needs no approval, and is
-- left out of the Daily Report's Inventory List (which is for the day's
-- field work). stock_movements.added_on_inventory marks those rows; the app
-- sets it on an add from those pages, skips the edit-approval step for them
-- (an edit applies directly), and the Daily Report leaves them out.
--
-- Back-fill: existing Restock entries added by hand (no job, visit, repair or
-- slip link) are marked too — Restock is only ever entered on the Inventory
-- pages. Other hand-added reasons (Return, Damaged, Adjustment) can also come
-- from the Daily Report's own Add, so they're left as they are.
--
-- Running this adds one column and marks those Restock rows; nothing else
-- changes (no quantity or stock is touched).

alter table public.stock_movements
  add column if not exists added_on_inventory boolean not null default false;

update public.stock_movements
set added_on_inventory = true
where reason = 'Restock'
  and schedule_job_id is null
  and filter_change_plan_id is null
  and install_plan_id is null
  and repair_plan_id is null
  and repair_plan_part_id is null
  and not added_on_inventory;
