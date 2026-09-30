-- Gives filter 9002 its full name, matching AppSheet — the last bare filter
-- code left on any CP system (only AW1RN_401-12 uses it, confirmed live).
-- Same shape as 20261012000000_cp_system_1152_name_and_pfs4on_quantity.sql:
-- stored as "<code> / <name>", so the CP table shows
-- "ANYWATER EMPTY (SMALL) - 12M" while anything that reads the code — the
-- Filter auto-fill (split_part(name, ' / ', 1)) and filter-parts.ts
-- (parseItemString(...).sku) — still resolves "9002" exactly as before.
--
-- Safe to re-run: an already-renamed component no longer matches the bare
-- '9002' check. Component order is preserved (WITH ORDINALITY).

update public.cp_systems
set components = (
  select jsonb_agg(
    case
      when trim(c->>'name') = '9002'
        then jsonb_set(c, '{name}', to_jsonb('9002 / ANYWATER EMPTY (SMALL)'::text))
      else c
    end
    order by ord
  )
  from jsonb_array_elements(components) with ordinality as t(c, ord)
)
where exists (
  select 1 from jsonb_array_elements(components) c where trim(c->>'name') = '9002'
);
