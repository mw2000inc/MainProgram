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
  // Every address this app ever geocodes (office or a member's) is in the
  // Philippines — without this, a short/generic fallback query (e.g. just
  // an area name, once the fallback chain below has truncated all the way
  // down) risks matching some unrelated place in another country instead
  // of failing cleanly, or losing precision to Nominatim considering
  // irrelevant candidates worldwide.
  url.searchParams.set("countrycodes", "ph")
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) return null
  const results = (await res.json()) as { lat: string; lon: string }[]
  if (!results.length) return null
  return { lat: Number(results[0].lat), lon: Number(results[0].lon) }
}

// Strips one or more leading floor/unit/suite/block/building fragments that
// Nominatim's free-text parser almost never resolves through (e.g. "7th &
// 8th Flr", "Unit 5", "Blk 3 Lot 12", "Bldg. A") — these describe a specific
// spot inside a larger building/lot that OSM has no knowledge of at that
// granularity, so keeping them in the query just makes an otherwise
// resolvable address fail outright (e.g. "7th & 8th Flr Axis Tower One
// Northgate Cyberzone Alabang Muntinlupa" — Axis Tower One itself may well
// be mapped, but not down to a specific floor). Chainable ("7th Flr, Unit
// 5, ..."), so this strips repeatedly until nothing more matches.
const LEADING_UNIT_PATTERN =
  /^(?:\d+(?:st|nd|rd|th)(?:\s*&\s*\d+(?:st|nd|rd|th))?\s+(?:flr\.?|floor)|unit\s+\S+|suite\s+\S+|rm\.?\s+\S+|room\s+\S+|blk\.?\s*\S+(?:\s+lot\.?\s*\S+)?|bldg\.?\s+\S+|building\s+\S+)\s*[,.]?\s*/i

function stripLeadingUnitFragments(address: string): string {
  let result = address.trim()
  let stripped = result.replace(LEADING_UNIT_PATTERN, "")
  while (stripped !== result) {
    result = stripped
    stripped = result.replace(LEADING_UNIT_PATTERN, "")
  }
  return result.trim()
}

// Drops words from the front, one at a time, of an already-cleaned address —
// the fallback for addresses with few or no commas (very common in real
// member addresses: a single free-typed line like "Axis Tower One Northgate
// Cyberzone Alabang Muntinlupa" with no punctuation at all), where the
// comma-segment strategies in geocodeWithFallback have nothing to work
// with. Converges from "building/landmark name" toward "just the
// area/city", the broadest fallback before giving up outright. Bounded
// (maxAttempts) since this is combined with the other fallback tiers under
// one overall candidate cap — see geocodeWithFallback.
function wordTruncations(text: string, maxAttempts = 6): string[] {
  const words = text
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  const maxDrop = Math.min(words.length - 1, maxAttempts)
  const out: string[] = []
  for (let drop = 1; drop <= maxDrop; drop++) {
    out.push(words.slice(drop).join(" "))
  }
  return out
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
  const unitStripped = stripLeadingUnitFragments(address)
  add(unitStripped)
  const cleaned = cleanAddress(unitStripped)
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

  // Comma-based segments contribute nothing for addresses with 0-2 commas
  // (very common in real free-typed input, e.g. "7th & 8th Flr Axis Tower
  // One Northgate Cyberzone Alabang Muntinlupa" has none at all) — this
  // covers those by dropping words from the front instead, converging
  // toward just the area/city.
  for (const candidate of wordTruncations(cleaned)) {
    add(candidate)
  }

  // Bounds worst-case latency: each attempt after the first costs another
  // ~1.1s to respect Nominatim's 1 req/sec usage policy, and
  // /api/directions geocodes two addresses (origin + destination) per
  // request. The list above is ordered most-specific-first, so truncating
  // here keeps the attempts most likely to succeed.
  const bounded = candidates.slice(0, 8)

  for (let i = 0; i < bounded.length; i++) {
    if (i > 0) await sleep(1100)
    const result = await geocodeOnce(bounded[i])
    if (result) {
      geocodeCache.set(address, result)
      return result
    }
  }
  return null
}
