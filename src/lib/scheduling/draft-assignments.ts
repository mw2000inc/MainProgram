import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  resolveJobLocation,
  pickBestTechnician,
  type DispatchEntityType,
  type SameDayJobRow,
} from "./smart-schedule"
import { isAssignedTechnician, normalizeTechnicianPair } from "@/lib/technicians"

// The Schedule page's "Draft Assignments" review tab — a batch, date-scoped
// counterpart to BulkTechnicianSuggestDialog's own per-job preview/apply
// flow. That dialog operates on schedule_jobs rows an admin has already
// picked; this instead starts from Filter Change/Collection/Repair records
// that don't have a real technician (or a schedule_jobs row) yet, clusters
// them the same way, and stages the result in schedule_draft_assignments
// for review before anything is written back. Deliberately excludes
// install_plans and vehicle/Liteace-pairing — out of scope for this pass
// (see this feature's own report).

export type DraftEntityType = "filter_change_plans" | "collections" | "repair_plans"

export interface SourcePlanColumns {
  table: DraftEntityType
  primaryColumn: "serviceman" | "th"
  secondaryColumn: "serviceman_2" | "th_2"
  dateColumns: [preD: string, base: string]
}

// The one place these three tables' differing technician-column names and
// due-date columns are listed — reused by both generation (reading pending
// rows) and approval (writing the accepted pick back). filter_change_plans/
// collections share serviceman/serviceman_2 (20260914000000_collection_install_technician_column.sql);
// repair_plans keeps its own original th/th_2 naming
// (20261003000000_second_technician.sql) — same inconsistency
// schedule-job-suggest.ts's own SOURCE_PLAN_BY_JOB_TYPE documents.
export const SOURCE_PLAN_TABLES: Record<"filter_change_plans" | "collections" | "repair_plans", SourcePlanColumns> = {
  filter_change_plans: { table: "filter_change_plans", primaryColumn: "serviceman", secondaryColumn: "serviceman_2", dateColumns: ["pre_d", "plan_date"] },
  collections: { table: "collections", primaryColumn: "serviceman", secondaryColumn: "serviceman_2", dateColumns: ["pre_d", "collection_date"] },
  repair_plans: { table: "repair_plans", primaryColumn: "th", secondaryColumn: "th_2", dateColumns: ["pre_d", "issued_date"] },
}

const JOB_TYPE_BY_ENTITY: Record<"filter_change_plans" | "collections" | "repair_plans", "filter_change" | "collection" | "repair"> = {
  filter_change_plans: "filter_change",
  collections: "collection",
  repair_plans: "repair",
}

export interface DraftAssignmentRow {
  id: string
  entity_type: "filter_change_plans" | "collections" | "repair_plans"
  entity_id: string
  target_date: string
  proposed_technician: string
  proposed_technician_2: string
  distance_km: number | null
  nearby_count: number
  explanation: string
  outside_coverage: boolean
  created_at: string
}

interface Candidate {
  entityType: "filter_change_plans" | "collections" | "repair_plans"
  entityId: string
  customerId: string | null
  orderNo: string | null
}

// dispatch_status eligibility mirrors daily-report-section.tsx's own
// isDailyReportEligible exactly — "due for this date" means the same set of
// rows that date's Daily Report would show, i.e. real confirmed work, not
// something still awaiting a customer's own confirmation. That also means
// approving a draft here never needs to touch dispatch_status itself: an
// eligible row that gains a real technician is already, by construction,
// "officially scheduled" the moment it's no longer blank.
function isDailyReportEligible(dispatchStatus: string | null | undefined): boolean {
  return dispatchStatus === "Confirmed" || dispatchStatus == null
}

async function fetchCandidates(admin: SupabaseClient, entityType: "filter_change_plans" | "collections" | "repair_plans", targetDate: string): Promise<Candidate[]> {
  const cols = SOURCE_PLAN_TABLES[entityType]
  const [preDCol, baseCol] = cols.dateColumns
  const orderColumn = entityType === "filter_change_plans" ? "order_number" : "order_no"
  // select("*") rather than a dynamic column list — this file's own column
  // names vary per table (see SOURCE_PLAN_TABLES), and supabase-js can only
  // type-check a select() string that's a literal, not one built from
  // variables like this.
  const { data } = await admin.from(cols.table).select("*").eq("status", "Pending")

  const rows = (data ?? []) as Record<string, unknown>[]
  return rows
    .filter((row) => {
      const dueDate = (row[preDCol] as string | null) || (row[baseCol] as string)
      if (dueDate !== targetDate) return false
      if (!isDailyReportEligible(row.dispatch_status as string | null | undefined)) return false
      const technician = (row[cols.primaryColumn] as string | null) ?? ""
      return !isAssignedTechnician(technician)
    })
    .map((row) => ({
      entityType,
      entityId: row.id as string,
      customerId: entityType !== "repair_plans" ? ((row.customer_id as string | null) ?? null) : null,
      orderNo: (row[orderColumn] as string | null) ?? null,
    }))
}

// Reads every eligible, still-unassigned Filter Change/Collection/Repair
// record due on targetDate, clusters them (same pickBestTechnician scoring
// as everywhere else in this app, including REAL schedule_jobs already on
// the books for that date as same-day neighbors), and upserts the result
// into schedule_draft_assignments for review. Writes nothing to any plan
// table — only the staging table. Re-running for the same date replaces
// whatever was there before via the table's own unique(entity_type,
// entity_id) constraint, so a stale batch never lingers next to a fresh one.
export async function generateDraftAssignmentsForDate(admin: SupabaseClient, targetDate: string): Promise<DraftAssignmentRow[]> {
  const candidateLists = await Promise.all(
    (["filter_change_plans", "collections", "repair_plans"] as const).map((entityType) => fetchCandidates(admin, entityType, targetDate))
  )
  const candidates = candidateLists.flat()
  if (candidates.length === 0) return []

  const { data: realSameDayRaw } = await admin
    .from("schedule_jobs")
    .select("id, technician, technician_2, latitude, longitude, route_sequence, order_no")
    .eq("scheduled_date", targetDate)
    .neq("status", "cancelled")
  const sameDayJobs: SameDayJobRow[] = (realSameDayRaw ?? []) as SameDayJobRow[]

  const upserts: Record<string, unknown>[] = []
  for (const candidate of candidates) {
    const jobType = JOB_TYPE_BY_ENTITY[candidate.entityType]
    const { point } = await resolveJobLocation(admin, jobType, candidate.entityType as DispatchEntityType, candidate.entityId, candidate.customerId, candidate.orderNo)
    const pick = pickBestTechnician(point, sameDayJobs)
    const outsideCoverage = point != null && (pick.minDistanceKm === null || pick.minDistanceKm > 15)
    const nearestJob = pick.nearestJobId ? sameDayJobs.find((j) => j.id === pick.nearestJobId) : undefined
    const nearestOrderLabel = nearestJob?.order_no?.trim() ? `Order #${nearestJob.order_no.trim()}` : "a nearby job"
    const explanation =
      point == null
        ? `This record's location couldn't be resolved — ${pick.technician} picked by workload balance (${pick.jobCount} job(s) already assigned that day) instead of proximity.`
        : pick.minDistanceKm != null
          ? `Clustered with ${nearestOrderLabel} (${pick.minDistanceKm.toFixed(1)} km away) — ${pick.technician} already has ${pick.jobCount} job(s) that day.`
          : `No technician has a located job that day yet — ${pick.technician} picked as the least-loaded option.`

    // Simulated neighbor for the rest of this batch — same reasoning
    // previewSuggestionsForJobs uses: later candidates in this same run
    // should see this pick as an already-assigned same-day job, not just
    // whatever was already committed to schedule_jobs before this run
    // started.
    sameDayJobs.push({
      id: `draft:${candidate.entityId}`,
      technician: pick.technician,
      technician_2: "",
      latitude: point?.lat ?? null,
      longitude: point?.lon ?? null,
      route_sequence: null,
      order_no: candidate.orderNo,
    })

    upserts.push({
      entity_type: candidate.entityType,
      entity_id: candidate.entityId,
      target_date: targetDate,
      proposed_technician: pick.technician,
      proposed_technician_2: "",
      distance_km: pick.minDistanceKm,
      nearby_count: pick.jobCount,
      explanation,
      outside_coverage: outsideCoverage,
    })
  }

  const { data: saved, error } = await admin
    .from("schedule_draft_assignments")
    .upsert(upserts, { onConflict: "entity_type,entity_id" })
    .select("*")
  if (error) throw error
  return (saved ?? []) as DraftAssignmentRow[]
}

// Writes each draft's (possibly admin-edited) technician/technician_2 onto
// its own source table using that table's real column names, then removes
// the draft row — there's no "approved" state to keep, the source table
// itself is now the record. Same compare-and-swap-free posture as a plain
// admin edit on that table's own inline cell (this IS effectively that,
// just batched): the draft review is the confirmation, same as every other
// preview-then-apply flow in this app.
export async function approveDraftAssignments(
  admin: SupabaseClient,
  drafts: { id: string; entityType: string; entityId: string; technician: string; technician2?: string }[]
): Promise<{ approved: number }> {
  let approved = 0
  for (const draft of drafts) {
    const cols = SOURCE_PLAN_TABLES[draft.entityType as keyof typeof SOURCE_PLAN_TABLES]
    if (!cols) continue
    const { primary, secondary } = normalizeTechnicianPair(draft.technician, draft.technician2 ?? "")
    if (!primary) continue
    const { error } = await admin
      .from(cols.table)
      .update({ [cols.primaryColumn]: primary, [cols.secondaryColumn]: secondary })
      .eq("id", draft.entityId)
    if (error) continue
    await admin.from("schedule_draft_assignments").delete().eq("id", draft.id)
    approved += 1
  }
  return { approved }
}
