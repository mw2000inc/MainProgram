// Real customer.address values are free text with no structured city field
// (confirmed by sampling live data: no consistent comma-before-city
// convention, stray trailing junk like "(House)", inconsistent casing) — so
// this is a best-effort label for admins to *read*, not something any
// scheduling decision is based on (that uses real lat/lon distance instead,
// see src/lib/scheduling/filter-change-suggest.ts). Never persisted: it's
// re-derived from the address every time it's shown, so it can never go
// stale relative to it.
//
// Longest name wins on purpose: "Quezon City" must beat a shorter
// accidental match, and "Bonifacio Global City"/"BGC" need to resolve to
// Taguig before the bare city list is tried at all.
const METRO_MANILA_CITIES = [
  "Quezon City",
  "Caloocan City",
  "Caloocan",
  "Las Piñas",
  "Las Pinas",
  "Makati City",
  "Makati",
  "Malabon",
  "Mandaluyong City",
  "Mandaluyong",
  "Marikina City",
  "Marikina",
  "Muntinlupa City",
  "Muntinlupa",
  "Navotas",
  "Parañaque City",
  "Paranaque City",
  "Parañaque",
  "Paranaque",
  "Pasay City",
  "Pasay",
  "Pasig City",
  "Pasig",
  "San Juan City",
  "San Juan",
  "Taguig City",
  "Taguig",
  "Valenzuela City",
  "Valenzuela",
  "Pateros",
  "Manila",
]

// City/municipality name -> the label actually shown (folds BGC/aliases and
// "City of X" phrasing back to one canonical name per real place).
const ALIASES: Record<string, string> = {
  bgc: "Taguig (BGC)",
  "bonifacio global city": "Taguig (BGC)",
  "city of dasmarinas": "Dasmariñas",
  "city of dasmariñas": "Dasmariñas",
  "city of san jose del monte": "San Jose del Monte",
}

// Common nearby provinces/cities that show up in real MW2000 customer
// addresses outside Metro Manila proper (Cavite, Laguna, Rizal, Bulacan
// commuter belt, plus a couple farther out seen in real samples).
const NEARBY_CITIES = [
  "Bonifacio Global City",
  "BGC",
  "Antipolo City",
  "Antipolo",
  "Cainta",
  "Taytay",
  "Rodriguez",
  "Montalban",
  "San Mateo",
  "Angono",
  "Bacoor City",
  "Bacoor",
  "Imus City",
  "Imus",
  "Dasmariñas City",
  "Dasmarinas City",
  "City of Dasmariñas",
  "City of Dasmarinas",
  "Dasmariñas",
  "Dasmarinas",
  "General Trias",
  "Kawit",
  "Noveleta",
  "Rosario",
  "Tanza",
  "Trece Martires",
  "Biñan",
  "Binan",
  "Santa Rosa",
  "San Pedro",
  "Cabuyao",
  "Calamba",
  "Meycauayan",
  "Marilao",
  "Bocaue",
  "San Jose del Monte",
  "Malolos",
  "Bacolod City",
  "Bacolod",
  "Cebu City",
  "Davao City",
]

const ALL_PLACE_NAMES = [...METRO_MANILA_CITIES, ...NEARBY_CITIES].sort((a, b) => b.length - a.length)

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Best-effort city/municipality label parsed out of a free-text address, or
// null if nothing recognizable matched. Case-insensitive, whole-word (so
// "Manila" doesn't fire on "Manila Envelope Co." — not realistic here, but
// keeps the match honest), longest known place name wins so "Quezon City"
// is preferred over any shorter substring that also happens to match.
export function extractCityLabel(address: string | null | undefined): string | null {
  if (!address) return null
  for (const name of ALL_PLACE_NAMES) {
    const pattern = new RegExp(`(?<![a-z])${escapeRegExp(name)}(?![a-z])`, "i")
    if (pattern.test(address)) {
      const key = name.toLowerCase()
      return ALIASES[key] ?? name
    }
  }
  return null
}
