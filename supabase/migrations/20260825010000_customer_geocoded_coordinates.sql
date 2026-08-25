-- Member List map panel needs a lat/lng per customer to drop a pin at their
-- address. Addresses are free-text, so geocoding happens client-side against
-- the Google Maps Geocoding API and the result is cached here — otherwise
-- every Member List page load would re-geocode every customer (slow, and
-- burns Google Maps API quota for no reason once an address's coordinates
-- are already known). Left null until first geocoded; null for an address
-- that fails to geocode too, so the map panel just skips that pin.
alter table public.customers
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
