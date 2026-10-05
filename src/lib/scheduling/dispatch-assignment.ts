import { TECHNICIANS, VEHICLE_CREWS } from "@/lib/constants"
import { crewOfTechnician, isAssignedTechnician, matchTechnicianAccount, normalizeTechnicianPair, type TechnicianAccount } from "@/lib/technicians"
import type { Customer, ScheduleJob } from "@/lib/types"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import { isSaturday } from "@/lib/schedule-timeframe"

// Who "Approve All & Dispatch" assigns to each visit, and with which vehicle.
//
// Technician, first match wins:
//   1. "planned"  — the visit's own planned technician(s);
//   2. "customer" — the customer's assigned technician(s);
//   3. "balanced" — the field technician (a TECHNICIANS roster name that has a
//      login account, so the job reaches their own Daily Report) with the
//      fewest jobs that day, counting both existing jobs and the ones this
//      batch has already handed out, so a batch is spread evenly;
//   4. "none"     — unassigned, only when there's no such technician at all.
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
export type AssignmentSource = "planned" | "customer" | "balanced" | "none" | "saturday"

export interface DispatchAssignment {
  pair: { primary: string; secondary: string }
  vehicle: string
  source: AssignmentSource
}

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

export function createDispatchAssigner(input: {
  jobs: Pick<ScheduleJob, "technician" | "technician2" | "scheduledDate" | "status" | "vehicle" | "createdAt">[]
  customers: Pick<Customer, "id" | "assignedTechnician" | "assignedTechnician2">[]
  accounts: TechnicianAccount[]
}): (visit: UnscheduledVisit, date: string) => DispatchAssignment {
  // Field technicians eligible for balancing: accounts that are on the roster.
  const fieldTechnicians = fieldTechnicianNames(input.accounts)

  const load = new Map<string, number>()
  const key = (date: string, name: string) => `${date}|${name.trim().toLowerCase()}`
  const addLoad = (date: string, name: string | undefined) => {
    if (isAssignedTechnician(name)) load.set(key(date, name!), (load.get(key(date, name!)) ?? 0) + 1)
  }
  for (const job of input.jobs) {
    if (job.status === "cancelled") continue
    addLoad(job.scheduledDate, job.technician)
    addLoad(job.scheduledDate, job.technician2)
  }

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

  return (visit, date) => {
    if (isSaturday(date)) return { pair: { primary: "", secondary: "" }, vehicle: "", source: "saturday" }
    let pair = normalizeTechnicianPair(isAssignedTechnician(visit.technician) ? visit.technician : "", visit.technician2)
    let source: AssignmentSource = "planned"
    if (!isAssignedTechnician(pair.primary)) {
      const customer = visit.customerId ? customerById.get(visit.customerId) : undefined
      if (customer && isAssignedTechnician(customer.assignedTechnician)) {
        pair = normalizeTechnicianPair(customer.assignedTechnician, customer.assignedTechnician2)
        source = "customer"
      } else if (fieldTechnicians.length > 0) {
        const least = fieldTechnicians.reduce((best, name) => ((load.get(key(date, name)) ?? 0) < (load.get(key(date, best)) ?? 0) ? name : best))
        pair = { primary: least, secondary: "" }
        source = "balanced"
      } else {
        source = "none"
      }
    }
    let vehicle = vehicleFor(pair)
    const crew = crewOfTechnician(pair.primary) ?? crewOfTechnician(pair.secondary) ?? crewOfVehicle(vehicle)
    if (crew) {
      pair = { primary: crew.primary, secondary: crew.secondary }
      vehicle = crew.vehicle
    }
    addLoad(date, pair.primary)
    addLoad(date, pair.secondary)
    return { pair, vehicle, source }
  }
}
