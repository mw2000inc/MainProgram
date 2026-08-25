// Server-only Nominatim client shared by /api/geocode and /api/directions —
// not imported by any client component, since the whole point of routing
// through our own API is to set a custom User-Agent (Nominatim's usage
// policy requires one; browsers refuse to let client code set it at all).
const USER_AGENT = "MW2000-ERP/1.0 (internal water-purification ERP; contact: marketing@mw2000inc.com)"

export interface GeoPoint {
  lat: number
  lon: number
}

// In-process cache keyed by the exact address string — mainly cuts latency
// for the office address, which /api/directions previously re-geocoded from
// scratch (several staggered fallback attempts, since it doesn't parse
// cleanly) on every single request. Member addresses are already cached
// per-customer in the database (see updateCustomerCoordinates); this is a
// second, cheaper layer for the office and any repeated ad-hoc lookups.
const geocodeCache = new Map<string, GeoPoint>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function geocodeOnce(query: string): Promise<GeoPoint | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search")
  url.searchParams.set("format", "json")
  url.searchParams.set("q", query)
  url.searchParams.set("limit", "1")
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) return null
  const results = (await res.json()) as { lat: string; lon: string }[]
  if (!results.length) return null
  return { lat: Number(results[0].lat), lon: Number(results[0].lon) }
}

// Strips patterns Nominatim's free-text parser tends to choke on but that are
// common in the addresses this app stores — a leading house number ("#1,"),
// "Brgy." abbreviations, and "Cor. <cross street>" clauses.
function cleanAddress(address: string): string {
  return address
    .replace(/^#?\d+[a-z]?\s*,\s*/i, "")
    .replace(/\bbrgy\.?\s*/gi, "Barangay ")
    .replace(/\bcor\.?\s+[^,]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*,+/g, ",")
    .trim()
}

// Tries the address as given, a cleaned version, then progressively broader
// (front-truncated) slices of it. Nominatim's free-text parser is far less
// forgiving of abbreviations and multi-street ("X corner Y") phrasing than a
// commercial geocoder — a precise address sometimes only resolves once
// trimmed down toward its locality (barangay/city) portion.
export function peekGeocodeCache(address: string): GeoPoint | undefined {
  return geocodeCache.get(address)
}

export async function geocodeWithFallback(address: string): Promise<GeoPoint | null> {
  const cached = geocodeCache.get(address)
  if (cached) return cached

  const candidates: string[] = []
  const seen = new Set<string>()
  const add = (candidate: string) => {
    const trimmed = candidate.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      candidates.push(trimmed)
    }
  }

  add(address)
  const cleaned = cleanAddress(address)
  add(cleaned)
  const segments = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  // Drop exactly one middle segment (never the first — house/street, the
  // most specific part — or the last — city, needed for context) and keep
  // the rest in order. Handles a single bad token poisoning the whole
  // query even though everything else is well-mapped — e.g. a barangay
  // stored as "Balongbato" but mapped in OSM as "Balong Bato": Nominatim
  // fails "31 Leland Drive, Balongbato, Quezon City" outright, but
  // "31 Leland Drive, Quezon City" (that one segment omitted) resolves at
  // full street precision. Tried before the broader front-truncation
  // fallback below since it keeps more of the address intact.
  for (let omit = 1; omit < segments.length - 1; omit++) {
    add([...segments.slice(0, omit), ...segments.slice(omit + 1)].join(", "))
  }

  for (let i = 1; i < segments.length - 1; i++) {
    add(segments.slice(i).join(", "))
  }

  for (let i = 0; i < candidates.length; i++) {
    if (i > 0) await sleep(1100)
    const result = await geocodeOnce(candidates[i])
    if (result) {
      geocodeCache.set(address, result)
      return result
    }
  }
  return null
}
