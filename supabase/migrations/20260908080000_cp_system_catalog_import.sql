-- Imports the real, complete AppSheet CP System catalog (44 system codes,
-- confirmed by the admin — this app's own cp_systems table only had 6 of
-- these before this migration). Upserts by system_code (already unique)
-- rather than a plain insert, so this is safe to re-run and correctly
-- REPLACES the 6 pre-existing rows' components wholesale with this same
-- authoritative source, not merges on top of them.
--
-- Component naming: reused the exact "<code> / <product name>" format the
-- 6 pre-existing rows already used (e.g. "011 / MW) Pre-Sediment") for
-- every code that has an established name -- six of those (011, 012, 013,
-- 016, 017, 019) came directly from those pre-existing rows; 401/402/403
-- come from PRODUCT_CATALOG in src/lib/constants.ts (AW) ANYWATER HK-05
-- Small/Medium/Large). Two more (015 "Far Infrared", 018 "Nano Fact
-- Filter") aren't in PRODUCT_CATALOG at all, but were confidently inferred
-- by reconciling UF71's own OLD component list (7 entries, no codes, e.g.
-- "MW) Nano Fact Filter"@12, "MW) Far Infrared"@24) against UF71's 7 NEW
-- coded rows from this same source data — every other code/interval pairs
-- up cleanly by an established name, leaving exactly these two unmatched
-- on each side. Every other code (014, 020, 021-025, 601, 603, 9002, 1152)
-- has no clean mapping anywhere in this app — stored as the bare code
-- itself, per the explicit instruction to prefer that over guessing.
--
-- Exact duplicate (code, interval) rows in the source data were deduped
-- into one component (e.g. PFS4ON's four identical "1152 @ 3mo" rows -> a
-- single entry). Where the SAME code appears at two DIFFERENT intervals
-- within one system (PF42: "1152" at both 3 and 6 months), both are kept
-- as separate entries — that's the source data as given, not a dedup bug,
-- and doesn't affect the "shortest interval wins" scheduling math either
-- way.
insert into public.cp_systems (system_code, components) values
  ('AW1RN_401-12', '[{"name":"401 / AW) ANYWATER HK-05 (Small)","intervalMonths":12},{"name":"9002","intervalMonths":12}]'::jsonb),
  ('UF4OSS', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"020","intervalMonths":3},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":6}]'::jsonb),
  ('PFS4ON', '[{"name":"1152","intervalMonths":3}]'::jsonb),
  ('UF41', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('RO51', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('RO52', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('UF44', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('UF45', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":3},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('UF46', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":12},{"name":"016 / MW) AOA","intervalMonths":24}]'::jsonb),
  ('UF47', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('UF52', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('UF53', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":6}]'::jsonb),
  ('RO57', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"015 / MW) Far Infrared","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('UF55', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":3},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('UF56', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":12},{"name":"016 / MW) AOA","intervalMonths":24}]'::jsonb),
  ('RO41', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('RO42', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('PF42', '[{"name":"1152","intervalMonths":3},{"name":"1152","intervalMonths":6}]'::jsonb),
  ('PF44', '[{"name":"1152","intervalMonths":3}]'::jsonb),
  ('RO71', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":6},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"016 / MW) AOA","intervalMonths":24},{"name":"015 / MW) Far Infrared","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('RO72', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":12},{"name":"016 / MW) AOA","intervalMonths":24},{"name":"015 / MW) Far Infrared","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('PF11', '[{"name":"1152","intervalMonths":3}]'::jsonb),
  ('PF22', '[{"name":"1152","intervalMonths":3}]'::jsonb),
  ('PF33', '[{"name":"1152","intervalMonths":3}]'::jsonb),
  ('RO73', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":6},{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":12},{"name":"014","intervalMonths":24},{"name":"016 / MW) AOA","intervalMonths":24},{"name":"015 / MW) Far Infrared","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('DY41', '[{"name":"021","intervalMonths":3},{"name":"022","intervalMonths":6},{"name":"023","intervalMonths":12},{"name":"024","intervalMonths":12}]'::jsonb),
  ('DY42', '[{"name":"021","intervalMonths":3},{"name":"022","intervalMonths":6},{"name":"023","intervalMonths":12},{"name":"025","intervalMonths":12}]'::jsonb),
  ('AW-S1', '[{"name":"401 / AW) ANYWATER HK-05 (Small)","intervalMonths":12}]'::jsonb),
  ('AW-M1', '[{"name":"402 / AW) ANYWATER HK-05 (Medium)","intervalMonths":12}]'::jsonb),
  ('AW-L1', '[{"name":"403 / AW) ANYWATER HK-05 (Large)","intervalMonths":12}]'::jsonb),
  ('UF48', '[{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('RO56', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"014","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('UF21', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3}]'::jsonb),
  ('RO43', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"016 / MW) AOA","intervalMonths":12}]'::jsonb),
  ('UF49', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('RO44', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":12},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('RO45', '[{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"014","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":6}]'::jsonb),
  ('RO46', '[{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"017 / MW) Post Carbon","intervalMonths":3},{"name":"014","intervalMonths":6}]'::jsonb),
  ('RO47', '[{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"014","intervalMonths":3},{"name":"017 / MW) Post Carbon","intervalMonths":3}]'::jsonb),
  ('RO59', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":3},{"name":"014","intervalMonths":12},{"name":"015 / MW) Far Infrared","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb),
  ('UF57', '[{"name":"011 / MW) Pre-Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"017 / MW) Post Carbon","intervalMonths":3},{"name":"019 / MW) Nano Silver UF Filter","intervalMonths":6}]'::jsonb),
  ('UF71', '[{"name":"013 / MW) Sediment","intervalMonths":3},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"011 / MW) Pre-Sediment","intervalMonths":6},{"name":"017 / MW) Post Carbon","intervalMonths":12},{"name":"018 / MW) Nano Fact Filter","intervalMonths":12},{"name":"016 / MW) AOA","intervalMonths":24},{"name":"015 / MW) Far Infrared","intervalMonths":24}]'::jsonb),
  ('PR 2 Stage / 6mos', '[{"name":"601","intervalMonths":6},{"name":"603","intervalMonths":6}]'::jsonb),
  ('RO48', '[{"name":"013 / MW) Sediment","intervalMonths":6},{"name":"012 / MW) Pre-Carbon","intervalMonths":6},{"name":"014","intervalMonths":24},{"name":"017 / MW) Post Carbon","intervalMonths":12}]'::jsonb)
on conflict (system_code) do update set components = excluded.components;
