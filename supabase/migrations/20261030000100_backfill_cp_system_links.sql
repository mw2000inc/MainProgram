-- OPTIONAL one-time backfill — run only if you want the orders that are
-- already unlinked fixed now. It changes data.
--
-- Links every ACTIVE order with a CP Start and no CP System to the CP System
-- its S/C names (same rule as 20261014000000 and
-- 20261030000000_auto_link_cp_system_from_sc). Each link fires the existing
-- trg_sync_filter_change_schedule, which fills the Filter on that order's
-- PENDING Filter Change visits and paces them on the system's shortest
-- interval. Completed / Cancelled visits are never touched (their Filter
-- stays as it is).
--
-- Checked live before writing (Oct 9, 2026): 57 orders match, all entered
-- since Oct 1 — including INC. Mens dorm 4, 001-0088 to 001-0092 (S/C
-- "RO42 / RO4" -> RO42). Orders whose S/C names no CP System are left alone.
-- Safe to re-run: an order already linked no longer matches.

update public.sale_list_entries e
set cp_system_id = s.id
from public.cp_systems s
where e.cp_system_id is null
  and e.status = 'ACTIVE'
  and e.cp_start is not null
  and trim(split_part(e.s_c, '/', 1)) <> ''
  and upper(trim(split_part(e.s_c, '/', 1))) = upper(trim(s.system_code));
