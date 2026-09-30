-- PF42 and PF44 name filter 1152 two ways: '1152 / Pre-Filtration Sediment Filter 20"'
-- (with the inch mark) and '1152 / Pre-Filtration Sediment Filter 20'
-- (without it), so the CP System page showed both spellings. This makes the
-- one without the mark match the other. Interval and quantity aren't touched,
-- and the code stays 1152, so Filter Change's codes are unaffected.
--
-- Scoped to the exact misspelled name, on any system that has it (checked
-- live: PF42 has it on 2 components, PF44 on 2; no other system does).
-- Component order is kept (WITH ORDINALITY). Safe to re-run: a fixed name
-- no longer matches.

update public.cp_systems
set components = (
  select jsonb_agg(
    case
      when trim(c->>'name') = '1152 / Pre-Filtration Sediment Filter 20'
        then jsonb_set(c, '{name}', to_jsonb('1152 / Pre-Filtration Sediment Filter 20"'::text))
      else c
    end
    order by ord
  )
  from jsonb_array_elements(components) with ordinality as t(c, ord)
)
where exists (
  select 1 from jsonb_array_elements(components) c
  where trim(c->>'name') = '1152 / Pre-Filtration Sediment Filter 20'
);
