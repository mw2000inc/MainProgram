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

export async function fetchDirections(
  originAddress: string,
  destinationAddress: string
): Promise<DirectionsResult | { error: string }> {
  const res = await fetch(
    `/api/directions?origin=${encodeURIComponent(originAddress)}&destination=${encodeURIComponent(destinationAddress)}`
  )
  const data = await res.json()
  if (!res.ok) return { error: data.error ?? "Failed to fetch directions" }
  return data as DirectionsResult
}
