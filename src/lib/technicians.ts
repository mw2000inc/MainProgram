import { TECHNICIANS } from "@/lib/constants"
import type { ScheduleJob } from "@/lib/types"

// Up to two technicians can be assigned wherever one could before (a plan's
// serviceman/th + serviceman_2/th_2, a customer's assigned technician(s), a
// schedule job's technician + technician_2). The rules for what a valid pair
// looks like live here so every surface — inline cells, forms, the Approval
// dialog, the Customer popover — applies exactly the same ones.

export const NOT_APPLICABLE_TECHNICIAN = "N/A"

// "N/A" is the roster's own "nobody" placeholder, and blank means the same —
// neither is a real person, so neither can have a second technician alongside.
export function isAssignedTechnician(name: string | null | undefined): boolean {
  const trimmed = (name ?? "").trim()
  return trimmed !== "" && trimmed !== NOT_APPLICABLE_TECHNICIAN
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
