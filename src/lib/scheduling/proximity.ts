import { areaOf } from "@/lib/scheduling/location-clusters"

// "Same neighborhood" for automatic dispatch: map distance when both places
// have coordinates (94% of customers do), else shared neighborhood keys read
// from the free-text address. Client-safe (used by Approve All & Dispatch in
// the browser as well as the server-side draft automations).

export interface Point {
  lat: number
  lon: number
}

// Within this distance two stops count as one neighborhood / building complex.
export const NEARBY_KM = 1

export function haversineKm(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function toPoint(lat: number | null | undefined, lon: number | null | undefined): Point | undefined {
  return typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined
}

const PLACE_WORDS = "building|bldg|tower|towers|condominium|condo|residences|compound|mall|plaza|village|subdivision|subd|estate|estates|homes|heights|townhouse|town house"
const PLACE_WORD_SET = new Set(PLACE_WORDS.split("|"))
const STREET_WORDS ="st|street|ave|avenue|road|rd|drive|dr|blvd|boulevard|lane|ln"
// Words that never name a place on their own ("3-storey bldg", "UG Level Mall").
const GENERIC = new Set(["the", "of", "and", "at", "near", "storey", "story", "floor", "flr", "level", "unit", "units", "ug", "gf", "lg", "upper", "lower", "ground", "located", "new", "old", "main", "blk", "lot", "phase"])
// Long roads that cross many neighborhoods — a shared one says nothing about proximity.
const MAJOR_ROADS = /\b(edsa|highway|hwy|expressway|national|commonwealth|ortigas|aurora|quezon|marcos|sumulong|roxas|taft|espana|macapagal|aguinaldo|governor s|governors|mcarthur|macarthur|katipunan|c5|circumferential|alabang zapote|shaw|osmena|buendia|gil puyat|ayala)\b/

const normalize = (address: string) =>
  address
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

const PLACE_ALIASES: Record<string, string> = { bldg: "building", condo: "condominium", subd: "subdivision", towers: "tower", estates: "estate", "town house": "townhouse" }

const nameBefore = (words: string[]) => {
  const kept: string[] = []
  for (let i = words.length - 1; i >= 0 && kept.length < 2; i--) {
    const w = words[i]
    if (GENERIC.has(w) || w in PLACE_ALIASES || PLACE_WORD_SET.has(w) || !/\p{L}/u.test(w) || w.length < 3) break
    kept.unshift(w)
  }
  return kept.join(" ")
}

// Neighborhood keys of an address, each scoped to its city / area so the
// same barangay or street name in two cities never matches:
//   barangay — "Brgy Sampaloc 1", "Barangay Pasong Tamo";
//   place    — a named building, compound, mall, village or subdivision
//              ("Phildipphil building", "Rancho Estate", "Medical City compound");
//   street   — a local street ("Central Ave", "Bato Bato St"), never a major
//              road like EDSA or Ortigas Avenue.
export function neighborhoodKeys(address: string | undefined): string[] {
  if (!address?.trim()) return []
  const area = areaOf(address).area.toLowerCase()
  const keys = new Set<string>()
  // Barangay: up to two words after the marker, stopping at a comma.
  for (const m of address.toLowerCase().matchAll(/\b(?:brgy|bgy|barangay)\b\.?\s+([^,]+)/g)) {
    const name = normalize(m[1]).split(" ").slice(0, 2).join(" ")
    if (name) keys.add(`barangay:${area}:${name}`)
  }
  const text = normalize(address)
  for (const m of text.matchAll(new RegExp(`\\b(${PLACE_WORDS})\\b`, "g"))) {
    const name = nameBefore(text.slice(0, m.index).trim().split(" ").filter(Boolean))
    if (name) keys.add(`place:${area}:${name} ${PLACE_ALIASES[m[1]] ?? m[1]}`)
  }
  for (const m of text.matchAll(new RegExp(`\\b(${STREET_WORDS})\\b`, "g"))) {
    const name = nameBefore(text.slice(0, m.index).trim().split(" ").filter(Boolean))
    if (name && !MAJOR_ROADS.test(name)) keys.add(`street:${area}:${name}`)
  }
  return [...keys]
}
