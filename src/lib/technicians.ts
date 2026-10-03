import { TECHNICIANS, VEHICLE_CREWS } from "@/lib/constants"
import type { ScheduleJob } from "@/lib/types"

// Up to two technicians can be assigned wherever one could before (a plan's
// serviceman/th + serviceman_2/th_2, a customer's assigned technician(s), a
// schedule job's technician + technician_2). The rules for what a valid pair
// looks like live here so every surface — inline cells, forms, the Approval
// dialog, the Customer popover — applies exactly the same ones.

export const NOT_APPLICABLE_TECHNICIAN = "N/A"

// "N/A" is the roster's own "nobody" placeholder, and blank means the same —
// neither is a real person, so neither can have a second technician alongside.
// "Unassigned" (any case) is treated the same way even though nothing in
// this app currently writes that literal string — every technician field
// this feeds is a free-typable combobox (technician-combobox.tsx) with no DB
// enum guarding it, so nothing rules out an admin typing it in, unlike
// status elsewhere which IS a Postgres enum and can't drift like this.
export function isAssignedTechnician(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim()
  if (trimmed === "" || trimmed === NOT_APPLICABLE_TECHNICIAN) return false
  return trimmed.toLowerCase() !== "unassigned"
}

// Trims both, then drops the second technician whenever it can't stand:
// the first isn't a real assignment (blank/"N/A"), the second is itself blank
// or "N/A", or it's the same person as the first (compared case-insensitively —
// "mell" and "Mell" are one person typed two ways). The first is never altered
// beyond trimming, so this can't lose the primary assignment.
export function normalizeTechnicianPair(
  primary: string | null | undefined,
  secondary: string | null | undefined
): { primary: string; secondary: string } {
  const first = (primary ?? "").trim()
  const second = (secondary ?? "").trim()
  const secondaryStands =
    isAssignedTechnician(first) && isAssignedTechnician(second) && second.toLowerCase() !== first.toLowerCase()
  return { primary: first, secondary: secondaryStands ? second : "" }
}

// A schedule job only shows up in a technician's own Daily Report when its
// technician_user_id / technician_2_user_id points at their login (RLS and
// ScheduleAgenda both key on that, not on the name). The name fields are
// free text — picked from the TECHNICIANS roster or typed — and a name on a
// record doesn't always match the account's own spelling (the roster itself
// had "Joselito Compereso" / "Jerson Capellon" against the accounts'
// "Joselito Camperoso" / "Jerson Capellan" until Oct 2026). So
// a name links to an account when it matches exactly (ignoring case and
// spacing), or when the first names match and the surnames are at most 2
// letters apart. Either way exactly one account must fit, or nothing is
// linked — a wrong link would show a job to the wrong technician.
export interface TechnicianAccount {
  id: string
  name: string
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

export function matchTechnicianAccount<A extends TechnicianAccount>(name: string, accounts: A[]): A | undefined {
  if (!isAssignedTechnician(name)) return undefined
  const target = normalizeName(name)
  const exact = accounts.filter((a) => normalizeName(a.name) === target)
  if (exact.length > 0) return exact.length === 1 ? exact[0] : undefined
  const [first, ...rest] = target.split(" ")
  const surname = rest.join(" ")
  if (!surname) return undefined
  const close = accounts.filter((a) => {
    const [aFirst, ...aRest] = normalizeName(a.name).split(" ")
    const aSurname = aRest.join(" ")
    return aFirst === first && !!aSurname && editDistance(aSurname, surname) <= 2
  })
  return close.length === 1 ? close[0] : undefined
}

// The login accounts for a job's technician pair, by name (see
// matchTechnicianAccount) — "" where no single account fits, so a changed
// technician never keeps the previous person's link (which would show the
// job to the wrong technician).
export function technicianAccountIds(
  primary: string,
  secondary: string,
  accounts: TechnicianAccount[]
): { technicianUserId: string; technician2UserId: string } {
  return {
    technicianUserId: matchTechnicianAccount(primary, accounts)?.id ?? "",
    technician2UserId: secondary ? (matchTechnicianAccount(secondary, accounts)?.id ?? "") : "",
  }
}

// The fixed crew for a vehicle (VEHICLE_CREWS), or undefined for a vehicle
// any technician can take.
export function crewForVehicle(vehicle: string | null | undefined): { primary: string; secondary: string } | undefined {
  const crew = vehicle ? VEHICLE_CREWS[vehicle.trim()] : undefined
  return crew ? { primary: crew[0], secondary: crew[1] } : undefined
}

// InlineTechnicianPairCell reports what changed as { primary?, secondary? };
// each table's own field names differ (serviceman/serviceman2, th/th2), so this
// maps that patch onto them. Only the keys that actually changed are included.
export function pairPatchToFields<P extends string, S extends string>(
  patch: { primary?: string; secondary?: string },
  keys: { primary: P; secondary: S }
): Partial<Record<P | S, string>> {
  const fields: Partial<Record<P | S, string>> = {}
  if (patch.primary !== undefined) fields[keys.primary] = patch.primary
  if (patch.secondary !== undefined) fields[keys.secondary] = patch.secondary
  return fields
}

// The Schedule page's technician filter options: the TECHNICIANS roster first,
// always (so the filter is fully usable from day one with no jobs, same as
// before), then any other name actually on a job — as either its technician OR
// its technician_2 — now that a name can be typed in instead of picked. Without
// this a custom-named job could never be filtered for. Exact-match dedupe
// against the roster, because matchesTechnician compares exactly.
export function technicianFilterOptions(jobs: Pick<ScheduleJob, "technician" | "technician2">[]): string[] {
  const roster: string[] = [...TECHNICIANS]
  const known = new Set(roster)
  const extras = new Set<string>()
  for (const job of jobs) {
    for (const raw of [job.technician, job.technician2]) {
      const name = (raw ?? "").trim()
      if (name && !known.has(name)) extras.add(name)
    }
  }
  return [...roster, ...Array.from(extras).sort((a, b) => a.localeCompare(b))]
}
