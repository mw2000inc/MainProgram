// Groups visits by area (city / municipality / province, read from the free-
// text address) and spreads the areas over a few days so each day covers one
// geographic zone — used by "Cancel & Auto-Distribute Saturday Queue".

// Zone order runs north → central → south, so areas next to each other in
// this list are next to each other on the map; contiguous runs of it become
// one day's route.
const AREAS: { area: string; zone: string; match: RegExp }[] = [
  { area: "Pampanga", zone: "North", match: /pampanga|angeles|san fernando|mabalacat|clark/ },
  { area: "Tarlac", zone: "North", match: /tarlac/ },
  { area: "Bulacan", zone: "North", match: /bulacan|malolos|meycauayan|marilao|bocaue|san jose del monte|baliuag|sta\.? maria|santa maria/ },
  { area: "Valenzuela", zone: "North", match: /valenzuela/ },
  { area: "Caloocan", zone: "North", match: /caloocan|kalookan|camarin|bagong silang/ },
  { area: "Malabon / Navotas", zone: "North", match: /malabon|navotas/ },
  { area: "Quezon City", zone: "North", match: /quezon city|\bq\.?\s?c\.?\b|cubao|novaliches|fairview|diliman|commonwealth|project \d|kamuning|katipunan|ugong norte|libis|tandang sora|batasan|galas/ },
  { area: "Marikina", zone: "East", match: /marikina/ },
  { area: "Rizal", zone: "East", match: /rizal|antipolo|cainta|taytay|binangonan|san mateo|rodriguez|montalban/ },
  { area: "Pasig", zone: "East", match: /pasig|ortigas|kapitolyo/ },
  { area: "San Juan", zone: "Central", match: /san juan|greenhills/ },
  { area: "Mandaluyong", zone: "Central", match: /mandaluyong|shaw blvd|edsa central/ },
  { area: "Manila", zone: "Central", match: /\bmanila\b|ermita|malate|sampaloc|tondo|binondo|sta\.? mesa|santa mesa|quiapo|paco|pandacan|intramuros|san andres/ },
  { area: "Makati", zone: "Central", match: /makati|legaspi village|salcedo|rockwell|poblacion makati|bel-?air/ },
  { area: "Taguig / BGC", zone: "Central", match: /taguig|\bbgc\b|bonifacio global|fort bonifacio|mckinley|mckinley hill|bonifacio ridge|trion tower|uptown bonifacio/ },
  { area: "Pateros", zone: "Central", match: /pateros/ },
  { area: "Pasay", zone: "South", match: /pasay|moa\b|mall of asia/ },
  { area: "Parañaque", zone: "South", match: /para[ñn]aque|bf homes|sucat|baclaran/ },
  { area: "Las Piñas", zone: "South", match: /las pi[ñn]as/ },
  { area: "Muntinlupa / Alabang", zone: "South", match: /muntinlupa|alabang|filinvest|ayala alabang|tunasan|putatan/ },
  { area: "Cavite", zone: "South", match: /cavite|imus|bacoor|dasmari[ñn]as|general trias|gen\.? trias|kawit|silang|tagaytay|carmona|gma\b/ },
  { area: "Laguna", zone: "South", match: /laguna|san pedro|bi[ñn]an|sta\.? rosa|santa rosa|calamba|cabuyao|los ba[ñn]os|san pablo/ },
  { area: "Batangas", zone: "South", match: /batangas|lipa|tanauan|sto\.? tomas/ },
]
const OTHER = { area: "Other / unknown area", zone: "Other" }

export function areaOf(address: string | undefined): { area: string; zone: string; order: number } {
  const text = (address ?? "").toLowerCase()
  // Several areas can appear (e.g. "Alabang–Zapote Rd, Las Piñas"): the one
  // mentioned LAST is usually the city.
  let best: { area: string; zone: string; order: number; at: number } | undefined
  AREAS.forEach((a, order) => {
    const re = new RegExp(a.match.source, "g")
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) if (!best || m.index >= best.at) best = { area: a.area, zone: a.zone, order, at: m.index }
  })
  return best ? { area: best.area, zone: best.zone, order: best.order } : { ...OTHER, order: AREAS.length }
}

export interface AreaCluster<T> {
  area: string
  zone: string
  order: number
  items: T[]
}

// Groups items by area and assigns whole areas to the given days: areas are
// taken in map order (north → south) and cut into contiguous runs of roughly
// equal size, one run per day, never splitting an area. "Other / unknown"
// goes to whichever day ends up lightest.
export function distributeByArea<T>(
  items: T[],
  addressOf: (item: T) => string | undefined,
  days: string[]
): { day: string; clusters: AreaCluster<T>[]; count: number }[] {
  const byArea = new Map<string, AreaCluster<T>>()
  for (const item of items) {
    const a = areaOf(addressOf(item))
    const cluster = byArea.get(a.area) ?? { ...a, items: [] }
    cluster.items.push(item)
    byArea.set(a.area, cluster)
  }
  const known = [...byArea.values()].filter((c) => c.zone !== OTHER.zone).sort((a, b) => a.order - b.order)
  const unknown = byArea.get(OTHER.area)
  const plan = days.map((day) => ({ day, clusters: [] as AreaCluster<T>[], count: 0 }))
  const total = known.reduce((n, c) => n + c.items.length, 0)
  let d = 0
  let filled = 0
  for (const cluster of known) {
    // Move on to the next day once this day holds its share, unless it's the last day.
    const target = (total * (d + 1)) / days.length
    if (plan[d].count > 0 && filled + cluster.items.length / 2 > target && d < days.length - 1) d++
    plan[d].clusters.push(cluster)
    plan[d].count += cluster.items.length
    filled += cluster.items.length
  }
  if (unknown) {
    const lightest = plan.reduce((a, b) => (b.count < a.count ? b : a))
    lightest.clusters.push(unknown)
    lightest.count += unknown.items.length
  }
  return plan
}
