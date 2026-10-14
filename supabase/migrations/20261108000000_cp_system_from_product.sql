-- A Sale List entry with a product but no S/C gets its CP System from the
-- product — when that product is only ever used with ONE CP System.
--
-- Why (2026-10-14): an order without a CP System gets Filter Change visits
-- with a blank Filter (the Filter is computed from the CP System's
-- components, 20261008000000). Most products are used with several systems
-- (e.g. 105 Oasis-T1: UF47 / RO41 / UF41 / ...; 201-BK Standard K: DY41 /
-- DY42), so the admin must pick the S/C — the Sale List form now says so and
-- lists the usual ones. But some products only ever take one system; for
-- those this links it automatically. Checked live: 401 ANYWATER HK-05 (Small)
-- → AW-S1 (all 10 orders) and 403 ANYWATER HK-05 (Large) → AW-L1 (both).
--
-- Rule: on insert, or when the product or S/C changes, an entry with no CP
-- System and a blank S/C whose product code (before ' / ') is used by at
-- least 2 other linked entries, ALL on the same CP System, gets that system
-- and its code as the S/C. Linking it fires trg_sync_filter_change_schedule,
-- which paces the visits and fills their Filters (Pending visits only).
-- An entry with an S/C typed in is left to trg_auto_link_cp_system_from_sc.
-- No backfill: checked live, no existing active order matches.

create or replace function public.auto_link_cp_system_from_product()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_product text := upper(trim(split_part(trim(coalesce(NEW.product_no, '')), ' / ', 1)));
  v_system uuid;
  v_code text;
  v_systems integer;
  v_orders integer;
begin
  if NEW.cp_system_id is not null or coalesce(trim(NEW.s_c), '') <> '' or v_product = '' then
    return null;
  end if;

  select count(distinct cp_system_id), count(*), min(cp_system_id::text)::uuid
    into v_systems, v_orders, v_system
    from public.sale_list_entries
    where id <> NEW.id
      and cp_system_id is not null
      and upper(trim(split_part(trim(coalesce(product_no, '')), ' / ', 1))) = v_product;

  if v_systems <> 1 or v_orders < 2 then
    return null;
  end if;

  select trim(system_code) into v_code from public.cp_systems where id = v_system;
  update public.sale_list_entries
    set cp_system_id = v_system,
        s_c = coalesce(v_code, s_c)
    where id = NEW.id and cp_system_id is null;
  return null;
end;
$$;

drop trigger if exists trg_auto_link_cp_system_from_product on public.sale_list_entries;
create trigger trg_auto_link_cp_system_from_product
  after insert or update of product_no, s_c on public.sale_list_entries
  for each row execute function public.auto_link_cp_system_from_product();
