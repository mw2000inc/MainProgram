import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { SOURCE_PLAN_TABLES, type DraftEntityType } from "./draft-assignments"

// "Clear Schedule" / "Unassign All" — the reverse of Draft Assignments'
// own Approve: wipes every schedule_jobs row for a date back to nothing, so
// the date is ready for a fresh Generate run. Reuses the exact same
// SOURCE_PLAN_TABLES column map draft-assignments.ts already defines (same
// serviceman/serviceman_2 vs th/th_2 split), just run in the opposite
// direction — blank instead of write.
const ENTITY_BY_JOB_TYPE: Partial<Record<string, DraftEntityType>> = {
  filter_change: "filter_change_plans",
  collection: "collections",
  repair: "repair_plans",
}

export interface ClearScheduleResult {
  jobsCleared: number
  plansUnlinked: number
}

// Deletes every non-cancelled schedule_jobs row scheduled on targetDate.
// Only "source records" (Filter Change/Collection/Repair plans, Install
// plans, customers) are protected from deletion — schedule_jobs itself is
// the dispatch/routing artifact this feature exists to clear, not a source
// record, so once its plan link (if any) is severed there is nothing left
// worth keeping it around for; leaving a blank orphaned row would risk
// find_or_create_schedule_job's own dedupe key later reattaching to stale
// state instead of creating a clean one.
//
// For any of the three synced plan types (filter_change_plans/collections/
// repair_plans — install_plans is deliberately out of scope, matching this
// feature's own spec), the linked row's own technician columns are cleared
// to '' (the real schema default every one of these columns already has —
// not the string "N/A", which is a cron-specific placeholder written
// elsewhere, not this table's blank convention) and its schedule_job_id set
// back to null, so it reads as fully unlinked and pending again — exactly
// what Draft Assignments' own fetchCandidates already looks for.
export async function clearScheduleForDate(admin: SupabaseClient, targetDate: string): Promise<ClearScheduleResult> {
  const { data: jobs } = await admin
    .from("schedule_jobs")
    .select("id, job_type")
    .eq("scheduled_date", targetDate)
    .neq("status", "cancelled")
  const rows = (jobs ?? []) as { id: string; job_type: string }[]
  if (rows.length === 0) return { jobsCleared: 0, plansUnlinked: 0 }

  let jobsCleared = 0
  let plansUnlinked = 0
  for (const job of rows) {
    const entityType = ENTITY_BY_JOB_TYPE[job.job_type]
    if (entityType) {
      const cols = SOURCE_PLAN_TABLES[entityType]
      const { data: unlinked } = await admin
        .from(cols.table)
        .update({ [cols.primaryColumn]: "", [cols.secondaryColumn]: "", schedule_job_id: null })
        .eq("schedule_job_id", job.id)
        .select("id")
      if (unlinked && unlinked.length > 0) plansUnlinked += 1
    }
    const { error } = await admin.from("schedule_jobs").delete().eq("id", job.id)
    if (!error) jobsCleared += 1
  }
  return { jobsCleared, plansUnlinked }
}
