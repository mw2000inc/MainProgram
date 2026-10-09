-- An order whose S/C names a CP System is linked to that CP System
-- automatically, so its Filter Change visits get their Filter filled in.
--
-- Why: the Filter on a generated Filter Change visit comes from the order's
-- linked CP System (cp_system_due_filters, 20261008000000). Linking was a
-- one-time backfill (20261014000000, Sep 30) plus the Sale List form's CP
-- System dropdown — so an order entered later without picking the dropdown
-- (e.g. INC. Mens dorm 4, 001-0088 to 001-0092, S/C "RO42 / RO4", entered
-- Oct 2) stays unlinked and every one of its visits shows a blank Filter.
-- Checked live: 57 ACTIVE orders entered since Oct 1 are in that state.
--
-- Now, when an order is inserted, or its S/C is edited, and it has no CP
-- System yet, it is linked to the CP System its S/C names — the part before
-- "/", trimmed and case-insensitive, the same rule 20261014000000 used
-- ("RO42 / RO4" -> RO42). The link is written as its own update of
-- cp_system_id, so the existing trg_sync_filter_change_schedule fires and
-- fills the Filter on the order's Pending visits (and paces them on the
-- system's interval), exactly as when an admin picks the CP System by hand.
-- A CP System already chosen is never changed; an S/C that names no CP
-- System (blank, "PR 2 Stage", ...) leaves the order as it is.
--
-- No loop: this trigger fires on insert or an update of s_c; its own update
-- sets only cp_system_id.
--
-- Running this changes no existing rows (it only creates a function and a
-- trigger). Linking the orders already unlinked is a separate, optional
-- one-time migration (20261030000100_backfill_cp_system_links.sql).

create or replace function public.auto_link_cp_system_from_sc()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text := upper(trim(split_part(coalesce(NEW.s_c, ''), '/', 1)));
  v_system uuid;
begin
  if NEW.cp_system_id is not null or v_code = '' then
    return null;
  end if;
  select id into v_system from public.cp_systems where upper(trim(system_code)) = v_code limit 1;
  if v_system is null then
    return null;
  end if;
  update public.sale_list_entries
    set cp_system_id = v_system
    where id = NEW.id and cp_system_id is null;
  return null;
end;
$$;

drop trigger if exists trg_auto_link_cp_system_from_sc on public.sale_list_entries;
create trigger trg_auto_link_cp_system_from_sc
  after insert or update of s_c on public.sale_list_entries
  for each row execute function public.auto_link_cp_system_from_sc();
