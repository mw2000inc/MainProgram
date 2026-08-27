-- Caches the MW2000 office's geocoded coordinates on company_settings,
-- mirroring the existing customers.latitude/longitude pattern (see
-- updateCustomerCoordinates / member-map-panel.tsx). Without this, the
-- office address — a single fixed value used as the origin of every
-- "Directions" lookup, for every member, by every admin — was being
-- re-geocoded from scratch on every single request. That's wasteful on its
-- own, but for an address that only resolves several fallback attempts deep
-- (as MW2000's real office address does), it also means every request pays
-- the full latency and flakiness of Nominatim's public endpoint for no
-- reason: the coordinates never change unless the address itself does.
-- Nullable — absent until the first successful geocode populates it (or
-- forever, if the office address genuinely can't be resolved), same as
-- customers.latitude/longitude.
alter table public.company_settings
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
