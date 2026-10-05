import { createScheduleJob, linkVisitToScheduleJob, updateScheduleJob } from "@/lib/api/schedule"
import { technicianAccountIds, type TechnicianAccount } from "@/lib/technicians"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import { requiresSaturdayApproval } from "@/lib/schedule-timeframe"

// Creates one active schedule job per unscheduled visit, linked to exactly
// that visit (Bulk Create Jobs and Approve All & Dispatch both use this).
//
// Each job is created as 'pending_approval', linked to its visit, then set to
// 'pending' (active) — so the database's job→record sync, which runs when a
// job becomes active, finds the visit already linked and never attaches the
// job to a different visit of the same order. The visits were already
// dispatch-confirmed, so the jobs don't wait for a second approval — except
// a job dated a Saturday, which stays 'pending_approval' until an admin
// confirms Saturday coverage (requiresSaturdayApproval).
export async function createJobsFromVisits(
  visits: UnscheduledVisit[],
  opts: {
    // The technician pair for a visit ("" primary = unassigned)…
    pairFor?: (visit: UnscheduledVisit) => { primary: string; secondary: string }
    dateFor: (visit: UnscheduledVisit) => string
    vehicle?: string
    // …or technician AND vehicle per visit, decided once its date is known
    // (Approve All & Dispatch's fallback assignment — see dispatch-assignment).
    assignFor?: (visit: UnscheduledVisit, date: string) => { pair: { primary: string; secondary: string }; vehicle: string }
    accounts: TechnicianAccount[]
    onProgress?: (done: number) => void
    // Make the jobs active even on a Saturday — set when an admin has just
    // explicitly assigned that Saturday's technicians.
    activate?: boolean
  }
): Promise<{ created: number; failed: string[]; awaitingApproval: number }> {
  let created = 0
  let awaitingApproval = 0
  const failed: string[] = []
  for (const visit of visits) {
    const scheduledDate = opts.dateFor(visit)
    const assigned = opts.assignFor?.(visit, scheduledDate)
    const pair = assigned?.pair ?? opts.pairFor?.(visit) ?? { primary: "", secondary: "" }
    try {
      const job = await createScheduleJob({
        jobType: visit.jobType,
        status: "pending_approval",
        scheduledDate,
        orderNo: visit.orderNo,
        customerId: visit.customerId,
        technician: pair.primary,
        technician2: pair.secondary,
        ...technicianAccountIds(pair.primary, pair.secondary, opts.accounts),
        vehicle: assigned?.vehicle ?? opts.vehicle ?? "",
        secondaryAddress: visit.address,
        notes: [visit.name, visit.detail].filter(Boolean).join(" — "),
        filterCodes: visit.filterCodes,
      })
      await linkVisitToScheduleJob(visit.table, visit.recordId, job.id)
      if (requiresSaturdayApproval(scheduledDate) && !opts.activate) awaitingApproval += 1
      else await updateScheduleJob(job.id, { status: "pending" })
      created += 1
    } catch (error) {
      failed.push(`${visit.orderNo}: ${error instanceof Error ? error.message : String(error)}`)
    }
    opts.onProgress?.(created + failed.length)
  }
  return { created, failed, awaitingApproval }
}
