-- Gives filter 1152 its full name on every CP system that uses it, and
-- restores PFS4ON's documented unit count.
--
-- 1152 was imported as a bare code (20260908080000_cp_system_catalog_import.sql)
-- because nothing in the app named it at the time. The name below comes from
-- the admin (matching AppSheet's own label). It's stored in the same
-- "<code> / <name>" form every other named component already uses, which the
-- CP table then shows as "Pre-Filtration Sediment Filter 20" - 3M". The code
-- part is unchanged, so anything that reads the code — the Filter auto-fill
-- (split_part(name, ' / ', 1) in 20261008000000_cp_system_filter_auto_fill.sql)
-- and filter-parts.ts (parseItemString(...).sku) — resolves "1152" exactly as
-- before.
--
-- PFS4ON: the import deduped AppSheet's four identical "1152 @ 3mo" rows into
-- one component (see that migration's own comment), losing the count. Setting
-- quantity 4 makes the CP table list it four times, as AppSheet did. quantity
-- is display-only (see CpSystemComponent.quantity in src/lib/types) — the
-- scheduling cron and stock deduction don't read it.
--
-- Safe to re-run: an already-renamed component no longer matches the bare
-- '1152' check, and setting quantity 4 again is a no-op. Component order is
-- preserved (WITH ORDINALITY).

update public.cp_systems
set components = (
  select jsonb_agg(
    case
      when trim(c->>'name') = '1152'
        then jsonb_set(c, '{name}', to_jsonb('1152 / Pre-Filtration Sediment Filter 20"'::text))
      else c
    end
    order by ord
  )
  from jsonb_array_elements(components) with ordinality as t(c, ord)
)
where exists (
  select 1 from jsonb_array_elements(components) c where trim(c->>'name') = '1152'
);

update public.cp_systems
set components = (
  select jsonb_agg(
    case
      when split_part(c->>'name', ' / ', 1) = '1152' and (c->>'intervalMonths')::integer = 3
        then jsonb_set(c, '{quantity}', '4'::jsonb)
      else c
    end
    order by ord
  )
  from jsonb_array_elements(components) with ordinality as t(c, ord)
)
where system_code = 'PFS4ON';
