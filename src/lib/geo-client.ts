// Browser-side helpers for the /api/geocode and /api/directions routes. The
// actual Nominatim/OSRM calls happen server-side (see those routes) — mainly
// because Nominatim's usage policy asks for a descriptive User-Agent header,
// and browsers refuse to let client code set that header at all.

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`)
  if (!res.ok) return null
  const data = (await res.json()) as { lat: number; lon: number }
  return data
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface DirectionsResult {
  origin: { lat: number; lon: number }
  destination: { lat: number; lon: number }
  // OSRM returns [lon, lat] pairs (GeoJSON order) — callers flip these to
  // [lat, lon] for Leaflet.
  geometry: [number, number][]
  distanceMeters: number
  durationSeconds: number
}

// originPoint/destinationPoint let a caller skip server-side geocoding
// entirely for a side it already has cached coordinates for (e.g. the office
// address in company_settings, or a member's customers.latitude/longitude)
// — the corresponding address is still sent as a fallback label/query the
// route can use if the point is omitted.
export async function fetchDirections(
  originAddress: string,
  destinationAddress: string,
  originPoint?: { lat: number; lon: number },
  destinationPoint?: { lat: number; lon: number }
): Promise<DirectionsResult | { error: string }> {
  const params = new URLSearchParams({ origin: originAddress, destination: destinationAddress })
  if (originPoint) {
    params.set("originLat", String(originPoint.lat))
    params.set("originLon", String(originPoint.lon))
  }
  if (destinationPoint) {
    params.set("destinationLat", String(destinationPoint.lat))
    params.set("destinationLon", String(destinationPoint.lon))
  }
  const res = await fetch(`/api/directions?${params.toString()}`)
  const data = await res.json()
  if (!res.ok) return { error: data.error ?? "Failed to fetch directions" }
  return data as DirectionsResult
}
