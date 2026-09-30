-- Fills in the blank Filter on Filter Change visits for orders that were
-- never linked to their CP System.
--
-- Why they were blank (checked live before writing this): Filter is filled in
-- by cp_system_due_filters(cp_system_id, ...) only for orders whose
-- cp_system_id is set. 254 of the 279 ACTIVE orders with a CP Start have no
-- cp_system_id (e.g. 001-0928 / 001-0929, product 106 / MW) Oasis-S2), so
-- every visit generated for them got the flat 3-month cadence and a blank
-- Filter. Their S/C field already names the system, though — "UF45 / UF4"
-- -> CP System UF45 — for 241 of them.
--
-- =========================================================================
-- 1. Re-run the schedule sync when an order's CP System changes. Until now
--    the trigger ignored cp_system_id, so linking (or changing) an order's
--    CP System on the Sale List form left its visits exactly as they were:
--    no filters, old cadence. Now a link immediately re-paces the order's
--    Pending visits to the system's shortest interval and fills every blank
--    Filter — the same thing that happens when an order is created already
--    linked. A Filter someone already typed is never overwritten (the
--    sync's own filter_type = '' guard), and Done/Cancelled visits are
--    never touched (its status = 'Pending' guard).
-- =========================================================================
drop trigger if exists trg_sync_filter_change_schedule on public.sale_list_entries;
create trigger trg_sync_filter_change_schedule
  after insert or update of cp_start, cp_end, status, order_number, customer_id, cp_system_id
  on public.sale_list_entries
  for each row execute function public.sync_filter_change_schedule();

-- =========================================================================
-- 2. Link each unlinked ACTIVE order to the CP System its S/C names: the
--    part before " / ", compared trimmed and case-insensitively against
--    cp_systems.system_code. Fires the trigger above for each order.
--
--    Checked live: 241 orders match. 240 are on systems whose shortest
--    interval is 3 months, so their visit dates don't move — they only gain
--    their Filter. One, 001-0155 (RO73), is on a 6-month system, so its
--    Pending visits are re-paced to every 6 months, the same as every order
--    already linked to RO73.
--
--    Not matched, left as they are: 10 orders with a blank S/C, and 3 whose
--    S/C is "PR 2 Stage" — that CP System no longer exists.
--
--    Safe to re-run: an order that's already linked no longer matches.
-- =========================================================================
update public.sale_list_entries e
set cp_system_id = s.id
from public.cp_systems s
where e.cp_system_id is null
  and e.status = 'ACTIVE'
  and e.cp_start is not null
  and upper(trim(split_part(e.s_c, '/', 1))) = upper(trim(s.system_code))
  and trim(split_part(e.s_c, '/', 1)) <> '';
