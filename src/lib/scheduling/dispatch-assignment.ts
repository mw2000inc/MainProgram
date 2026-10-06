import { TECHNICIANS, VEHICLE_CREWS } from "@/lib/constants"
import { crewOfTechnician, isAssignedTechnician, matchTechnicianAccount, normalizeTechnicianPair, type TechnicianAccount } from "@/lib/technicians"
import type { Customer, ScheduleJob } from "@/lib/types"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import { isSaturday } from "@/lib/schedule-timeframe"
import { haversineKm, NEARBY_KM, neighborhoodKeys, toPoint, type Point } from "@/lib/scheduling/proximity"

// Who "Approve All & Dispatch" assigns to each visit, and with which vehicle.
//
// Technician, first match wins:
//   1. "planned"  — the visit's own planned technician(s);
//      "installation" — an Installation goes to the crew of INSTALL_VEHICLE
//      (the Liteace team, Eubert + Jayson): it carries the units. Other jobs
//      at the same place or nearby then join that crew through the rules
//      below. Soft cap: once that crew already has INSTALL_CREW_DAILY_CAP
//      errands that day, an install at a NEW place falls through to the rules
//      below with the crew left out — the nearest other team, else the least
//      busy. An install at a place the crew is already going to, or within
//      NEARBY_KM of one, still goes to the crew past the cap;
//   2. "location" — the team already going to the same place that day: a
//      job or visit with the same Member Account Number or the same address
//      (five units in one dorm, a member's filter change and collection), so
//      one team and vehicle covers the whole stop;
//   3. "customer" — the customer's assigned technician(s);
//   4. "nearby"   — the team already working in the same neighborhood that
//      day: the closest stop within NEARBY_KM (1 km) on the map when both
//      places have coordinates, otherwise one sharing a barangay, a named
//      building / compound / village, or a local street in the same city
//      (see proximity.ts);
//   5. "balanced" — the field technician (a TECHNICIANS roster name that has a
//      login account, so the job reaches their own Daily Report) with the
//      fewest errands that day, counting both existing jobs and the ones this
//      batch has already handed out, so a batch is spread evenly;
//   6. "none"     — unassigned, only when there's no such technician at all.
// Workload is counted in ERRANDS, not jobs: every job at one place (same
// Member Account Number, else same address, else same customer) is one
// errand — a member's filter change + collection, or five units in one
// building, count once.
// Vehicle: a fixed crew's vehicle when the pair is that crew (the Liteace for
// Eubert + Jayson), otherwise the vehicle that technician took on their most
// recent job, otherwise none.
// Crews always travel together: if either technician is a crew member, or
// the vehicle is a crew's vehicle, the job gets the whole crew (Eubert
// Montalbo AND Jayson Sapitin) and that vehicle — both logins linked.
//
// SATURDAYS ARE NEVER AUTO-ASSIGNED ("saturday"): technician availability
// changes every Saturday, so a Saturday job is always left Unassigned, with
// no vehicle — not even the visit's planned technician — until an admin picks
// that Saturday's technicians ("Assign Saturday Coverage").
export type AssignmentSource = "planned" | "installation" | "location" | "customer" | "nearby" | "balanced" | "none" | "saturday"

export interface DispatchAssignment {
  pair: { primary: string; secondary: string }
  vehicle: string
  source: AssignmentSource
}

// The vehicle every Installation is dispatched with (with its crew).
export const INSTALL_VEHICLE = "Liteace"
// Errands (separate places) per day after which installs at a new place stop
// defaulting to that crew.
export const INSTALL_CREW_DAILY_CAP = 5

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

const crewOfVehicle = (vehicle: string) => {
  const crew = vehicle ? VEHICLE_CREWS[vehicle] : undefined
  return crew ? { vehicle, primary: crew[0], secondary: crew[1] } : undefined
}

// The field technicians automatic assignment (and Saturday coverage) can use:
// login accounts whose name is on the TECHNICIANS roster, alphabetically.
export function fieldTechnicianNames(accounts: TechnicianAccount[]): string[] {
  const roster = TECHNICIANS.filter(isAssignedTechnician)
  return accounts
    .filter((account) => roster.some((name) => matchTechnicianAccount(name, [account])))
    .map((account) => account.name)
    .sort((a, b) => a.localeCompare(b))
}

// Address compared ignoring case, spacing and punctuation.
const normalizeAddress = (address: string | undefined) =>
  (address ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

export function createDispatchAssigner(input: {
  jobs: (Pick<ScheduleJob, "technician" | "technician2" | "scheduledDate" | "status" | "vehicle" | "createdAt"> &
    Partial<Pick<ScheduleJob, "customerId" | "secondaryAddress" | "latitude" | "longitude">>)[]
  customers: (Pick<Customer, "id" | "assignedTechnician" | "assignedTechnician2"> &
    Partial<Pick<Customer, "memberAccountNumber" | "latitude" | "longitude">>)[]
  accounts: TechnicianAccount[]
}): (visit: UnscheduledVisit, date: string) => DispatchAssignment {
  // Field technicians eligible for balancing: accounts that are on the roster.
  const fieldTechnicians = fieldTechnicianNames(input.accounts)

  // Each technician's errands per day (see errandOf): distinct places.
  const errands = new Map<string, Set<string>>()
  const key = (date: string, name: string) => `${date}|${name.trim().toLowerCase()}`
  const addLoad = (date: string, name: string | undefined, errand: string) => {
    if (!isAssignedTechnician(name)) return
    const set = errands.get(key(date, name!)) ?? new Set<string>()
    set.add(errand)
    errands.set(key(date, name!), set)
  }
  const loadOf = (date: string, name: string) => errands.get(key(date, name))?.size ?? 0

  // Each technician's most recent vehicle.
  const lastVehicle = new Map<string, string>()
  for (const job of [...input.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (job.vehicle?.trim() && isAssignedTechnician(job.technician)) lastVehicle.set(job.technician.trim().toLowerCase(), job.vehicle.trim())
  }
  const vehicleFor = (pair: { primary: string; secondary: string }) => {
    for (const [vehicle, crew] of Object.entries(VEHICLE_CREWS)) {
      if (crew && pair.secondary && [pair.primary, pair.secondary].every((n) => crew.some((c) => sameName(c, n)))) return vehicle
    }
    return isAssignedTechnician(pair.primary) ? (lastVehicle.get(pair.primary.trim().toLowerCase()) ?? "") : ""
  }

  const customerById = new Map(input.customers.map((c) => [c.id, c]))

  // The team (technicians + vehicle) already going to each place on each
  // day, keyed by Member Account Number and by address (addresses shorter
  // than 8 characters are too vague to group on).
  const placeKeys = (date: string, customerId: string | undefined, address: string | undefined) => {
    const keys: string[] = []
    const account = customerId ? customerById.get(customerId)?.memberAccountNumber?.trim() : ""
    if (account) keys.push(`${date}|account:${account.toLowerCase()}`)
    const place = normalizeAddress(address)
    if (place.length >= 8) keys.push(`${date}|address:${place}`)
    return keys
  }
  type Team = { pair: { primary: string; secondary: string }; vehicle: string }
  const teamAt = new Map<string, Team>()
  const rememberTeam = (keys: string[], team: Team) => {
    if (!isAssignedTechnician(team.pair.primary)) return
    for (const k of keys) if (!teamAt.has(k)) teamAt.set(k, team)
  }
  // Every assigned stop per day, for the neighborhood match: its map point
  // (the job's own, else its customer's) and its neighborhood keys.
  const stops: { date: string; point?: Point; keys: string[]; team: Team }[] = []
  const pointOf = (customerId: string | undefined, lat?: number, lon?: number) => {
    const customer = customerId ? customerById.get(customerId) : undefined
    return toPoint(lat, lon) ?? toPoint(customer?.latitude, customer?.longitude)
  }
  const rememberStop = (date: string, point: Point | undefined, address: string | undefined, team: Team) => {
    if (isAssignedTechnician(team.pair.primary)) stops.push({ date, point, keys: neighborhoodKeys(address), team })
  }
  // The closest same-day team within NEARBY_KM; without coordinates on
  // either side, the first one sharing a neighborhood key.
  const nearbyTeam = (date: string, point: Point | undefined, keys: string[], skip?: (team: Team) => boolean) => {
    let best: { team: Team; km: number } | undefined
    for (const stop of stops) {
      if (stop.date !== date || skip?.(stop.team)) continue
      if (point && stop.point) {
        const km = haversineKm(point, stop.point)
        if (km <= NEARBY_KM && (!best || km < best.km)) best = { team: stop.team, km }
      } else if (!best && stop.keys.some((k) => keys.includes(k))) {
        best = { team: stop.team, km: NEARBY_KM }
      }
    }
    return best?.team
  }

  // One errand per place: the first place key, else the customer, else the
  // job itself.
  const errandOf = (date: string, customerId: string | undefined, address: string | undefined, own: string) =>
    placeKeys(date, customerId, address)[0] ?? (customerId ? `${date}|customer:${customerId}` : own)

  let jobIndex = 0
  for (const job of [...input.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (job.status === "cancelled") continue
    const errand = errandOf(job.scheduledDate, job.customerId, job.secondaryAddress, `job:${jobIndex++}`)
    addLoad(job.scheduledDate, job.technician, errand)
    addLoad(job.scheduledDate, job.technician2, errand)
    const team = { pair: normalizeTechnicianPair(job.technician, job.technician2), vehicle: job.vehicle?.trim() ?? "" }
    rememberTeam(placeKeys(job.scheduledDate, job.customerId, job.secondaryAddress), team)
    rememberStop(job.scheduledDate, pointOf(job.customerId, job.latitude, job.longitude), job.secondaryAddress, team)
  }

  return (visit, date) => {
    if (isSaturday(date)) return { pair: { primary: "", secondary: "" }, vehicle: "", source: "saturday" }
    const keys = placeKeys(date, visit.customerId, visit.address)
    const point = pointOf(visit.customerId)
    let pair = normalizeTechnicianPair(isAssignedTechnician(visit.technician) ? visit.technician : "", visit.technician2)
    let source: AssignmentSource = "planned"
    let teamVehicle = ""
    let nearby: Team | undefined
    const installCrew = visit.jobType === "installation" ? crewOfVehicle(INSTALL_VEHICLE) : undefined
    const isCrew = (crew: typeof installCrew, p: { primary: string; secondary: string }) =>
      !!crew && [p.primary, p.secondary].some((n) => !!n && (sameName(n, crew.primary) || sameName(n, crew.secondary)))
    // Install crew at its cap AND this install is a separate place (not one
    // the crew is already going to, nor within NEARBY_KM of one): it goes to
    // another team, never to that crew.
    const crewAtCap = !!installCrew && loadOf(date, installCrew.primary) >= INSTALL_CREW_DAILY_CAP
    const crewAlreadyHere =
      crewAtCap &&
      (keys.some((k) => isCrew(installCrew, teamAt.get(k)?.pair ?? { primary: "", secondary: "" })) ||
        !!nearbyTeam(date, point, neighborhoodKeys(visit.address), (t) => !isCrew(installCrew, t.pair)))
    const fullCrew = crewAtCap && !crewAlreadyHere ? installCrew : undefined
    const isFullCrew = (p: { primary: string; secondary: string }) => isCrew(fullCrew, p)
    const team = keys.map((k) => teamAt.get(k)).find((t) => t && !isFullCrew(t.pair))
    if (!isAssignedTechnician(pair.primary) && installCrew && !fullCrew) {
      pair = { primary: installCrew.primary, secondary: installCrew.secondary }
      teamVehicle = installCrew.vehicle
      source = "installation"
    } else if (!isAssignedTechnician(pair.primary) && team) {
      pair = team.pair
      teamVehicle = team.vehicle
      source = "location"
    } else if (!isAssignedTechnician(pair.primary)) {
      const customer = visit.customerId ? customerById.get(visit.customerId) : undefined
      const customerPair = customer ? normalizeTechnicianPair(customer.assignedTechnician, customer.assignedTechnician2) : undefined
      const candidates = fieldTechnicians.filter((name) => !isFullCrew({ primary: name, secondary: "" }))
      if (customerPair && isAssignedTechnician(customerPair.primary) && !isFullCrew(customerPair)) {
        pair = customerPair
        source = "customer"
      } else if ((nearby = nearbyTeam(date, point, neighborhoodKeys(visit.address), (t) => isFullCrew(t.pair)))) {
        pair = nearby.pair
        teamVehicle = nearby.vehicle
        source = "nearby"
      } else if (candidates.length > 0) {
        const least = candidates.reduce((best, name) => (loadOf(date, name) < loadOf(date, best) ? name : best))
        pair = { primary: least, secondary: "" }
        source = "balanced"
      } else {
        source = "none"
      }
    }
    let vehicle = teamVehicle || vehicleFor(pair)
    // A fallback technician whose last vehicle was the full crew's keeps no vehicle.
    if (fullCrew && sameName(vehicle, fullCrew.vehicle) && !isFullCrew(pair)) vehicle = ""
    const crew =crewOfTechnician(pair.primary) ?? crewOfTechnician(pair.secondary) ?? crewOfVehicle(vehicle)
    if (crew) {
      pair = { primary: crew.primary, secondary: crew.secondary }
      vehicle = crew.vehicle
    }
    const errand = errandOf(date, visit.customerId, visit.address, `visit:${visit.key}`)
    addLoad(date, pair.primary, errand)
    addLoad(date, pair.secondary, errand)
    rememberTeam(keys, { pair, vehicle })
    rememberStop(date, point, visit.address, { pair, vehicle })
    return { pair, vehicle, source }
  }
}
