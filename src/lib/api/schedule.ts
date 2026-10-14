import { supabase } from "@/lib/supabase/client"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import type { ScheduleJob, ScheduleJobSource, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

type ScheduleJobRow = {
  id: string
  job_type: ScheduleJobType
  technician: string
  vehicle: string
  technician_2: string | null
  customer_id: string | null
  order_no: string | null
  scheduled_date: string
  scheduled_time: string | null
  status: ScheduleJobStatus
  notes: string | null
  remarks: string | null
  created_at: string
  product_id: string | null
  quantity: number | null
  inventory_deducted_at: string | null
  secondary_address: string | null
  technician_user_id: string | null
  technician_2_user_id: string | null
  // Generated: both logins as a list (20261109000000); absent until then.
  technician_user_ids?: string[] | null
  latitude: number | null
  longitude: number | null
  location_source: ScheduleJob["locationSource"] | null
  route_sequence: number | null
  filter_codes?: string | null
  source?: ScheduleJobSource | null
  rescheduled_from?: string | null
}

function fromRow(row: ScheduleJobRow): ScheduleJob {
  return {
    id: row.id,
    jobType: row.job_type,
    technician: row.technician,
    vehicle: row.vehicle,
    technician2: row.technician_2 ?? undefined,
    customerId: row.customer_id ?? undefined,
    orderNo: row.order_no ?? undefined,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    remarks: row.remarks ?? undefined,
    createdAt: row.created_at,
    productId: row.product_id ?? undefined,
    quantity: row.quantity ?? undefined,
    inventoryDeductedAt: row.inventory_deducted_at ?? undefined,
    secondaryAddress: row.secondary_address ?? undefined,
    technicianUserId: row.technician_user_id ?? undefined,
    technician2UserId: row.technician_2_user_id ?? undefined,
    technicianUserIds: row.technician_user_ids ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    locationSource: row.location_source ?? undefined,
    routeSequence: row.route_sequence ?? undefined,
    filterCodes: row.filter_codes || undefined,
    source: row.source ?? "manual",
    rescheduledFrom: row.rescheduled_from ?? undefined,
  }
}

function toRow(input: Partial<Omit<ScheduleJob, "id" | "createdAt" | "source">>) {
  const row: Record<string, unknown> = {}
  if (input.jobType !== undefined) row.job_type = input.jobType
  if (input.technician !== undefined) row.technician = input.technician
  if (input.vehicle !== undefined) row.vehicle = input.vehicle
  if (input.technician2 !== undefined) row.technician_2 = input.technician2 || null
  if (input.customerId !== undefined) row.customer_id = input.customerId || null
  if (input.orderNo !== undefined) row.order_no = input.orderNo || null
  if (input.scheduledDate !== undefined) row.scheduled_date = input.scheduledDate
  if (input.scheduledTime !== undefined) row.scheduled_time = input.scheduledTime || null
  if (input.status !== undefined) row.status = input.status
  if (input.notes !== undefined) row.notes = input.notes || null
  if (input.remarks !== undefined) row.remarks = input.remarks || null
  if (input.productId !== undefined) row.product_id = input.productId || null
  if (input.quantity !== undefined) row.quantity = input.quantity ?? null
  if (input.secondaryAddress !== undefined) row.secondary_address = input.secondaryAddress || null
  if (input.technicianUserId !== undefined) row.technician_user_id = input.technicianUserId || null
  if (input.technician2UserId !== undefined) row.technician_2_user_id = input.technician2UserId || null
  if (input.filterCodes !== undefined) row.filter_codes = input.filterCodes
  if (input.rescheduledFrom !== undefined) row.rescheduled_from = input.rescheduledFrom || null
  return row
}

// Paginates via fetchAllRows rather than a single un-ranged select() — see
// that helper's own comment for why: PostgREST silently caps an un-ranged
// select() at 1000 rows on this project, already confirmed to have
// actually truncated filter_change_plans in production once it grew past
// that. schedule_jobs hasn't hit that size yet, but every plan-row's own
// technician/route-sequence/notes lookup (withJob() in
// pending-approvals-panel.tsx, and the Schedule page's own agenda) joins
// against this list in memory — a silent truncation here wouldn't error,
// it would just make some real jobs' technician assignments disappear.
export async function listScheduleJobs(): Promise<ScheduleJob[]> {
  const data = await fetchAllRows<ScheduleJobRow>((from, to) =>
    supabase.from("schedule_jobs").select("*").order("scheduled_date", { ascending: true }).range(from, to)
  )
  return data.map(fromRow)
}

export async function createScheduleJob(input: Omit<ScheduleJob, "id" | "createdAt" | "source">): Promise<ScheduleJob> {
  const { data, error } = await supabase.from("schedule_jobs").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as ScheduleJobRow)
}

export async function updateScheduleJob(id: string, input: Partial<Omit<ScheduleJob, "id" | "createdAt" | "source">>): Promise<ScheduleJob> {
  const { data, error } = await supabase.from("schedule_jobs").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as ScheduleJobRow)
}

// Links a Filter Change / install / repair / collection record to the job
// just created for it from the Schedule's Unscheduled Visits — only while
// it's still unlinked, so it never steals a record another job already has.
// One open job per Order No. and job type: the order's approved ('pending')
// or draft ('pending_approval') job of this type, if it already has one —
// read fresh from the database, not the cached list, so two admins (or two
// quick saves) can't both add one. Every hand-made job checks this first
// (Schedule Job, the Add forms' drafts, Unscheduled Visits, auto-suggest's
// new jobs); the automatic drafts already skip such orders. Different types
// for the same order (a Filter Change and a Collection) are fine, and so are
// errands ('other') and jobs without an Order No.
export async function findOpenJobForOrder(
  jobType: ScheduleJobType,
  orderNo: string | undefined,
  excludeJobId?: string
): Promise<Pick<ScheduleJob, "id" | "status" | "scheduledDate"> | undefined> {
  const order = orderNo?.trim()
  if (!order || jobType === "other") return undefined
  let query = supabase
    .from("schedule_jobs")
    .select("id, status, scheduled_date")
    .eq("job_type", jobType)
    .eq("order_no", order)
    .in("status", ["pending", "pending_approval"])
    .order("scheduled_date")
    .limit(1)
  if (excludeJobId) query = query.neq("id", excludeJobId)
  const { data, error } = await query
  if (error) throw error
  const row = data?.[0]
  return row ? { id: row.id, status: row.status as ScheduleJobStatus, scheduledDate: row.scheduled_date } : undefined
}

// A Filter Change job's filters edited in the Schedule Job form go to its
// still-open Filter Change record too — completing the record is what
// deducts them (20261019000000), so the two must list the same filters.
export async function syncJobFiltersToRecord(jobId: string, filterCodes: string): Promise<void> {
  const { error } = await supabase
    .from("filter_change_plans")
    .update({ filter_type: filterCodes })
    .eq("schedule_job_id", jobId)
    .not("status", "in", "(Completed,Cancelled)")
  if (error) throw error
}

export type ClearScheduleResult = { cleared: number; noJob: number; completed: number; withStock: number }

// "Clear Schedule": removes the schedule job of each given Filter Change /
// Install / Repair / Collection record, so the record is unscheduled again —
// the record itself is untouched; the database only clears its link
// (schedule_job_id … on delete set null), and its job (technician, vehicle,
// date) leaves the Schedule board and the technicians' agendas. A job that is
// completed, or carries stock movements or recorded filters, is left alone and
// counted, never deleted: that's finished work, not a schedule.
export async function clearSchedulesForRecords(
  table: "filter_change_plans" | "install_plans" | "repair_plans" | "collections",
  recordIds: string[]
): Promise<ClearScheduleResult> {
  const result: ClearScheduleResult = { cleared: 0, noJob: 0, completed: 0, withStock: 0 }
  if (recordIds.length === 0) return result
  const { data: records, error } = await supabase.from(table).select("id, schedule_job_id").in("id", recordIds)
  if (error) throw error
  const jobIds = [...new Set((records ?? []).map((r) => r.schedule_job_id as string | null).filter((id): id is string => !!id))]
  result.noJob = (records ?? []).filter((r) => !r.schedule_job_id).length
  if (jobIds.length === 0) return result
  const [{ data: jobs, error: jobsError }, { data: moved }, { data: items }] = await Promise.all([
    supabase.from("schedule_jobs").select("id, status").in("id", jobIds),
    supabase.from("stock_movements").select("schedule_job_id").in("schedule_job_id", jobIds),
    supabase.from("schedule_job_filter_items").select("schedule_job_id").in("schedule_job_id", jobIds),
  ])
  if (jobsError) throw jobsError
  const stocked = new Set([...(moved ?? []), ...(items ?? [])].map((r) => r.schedule_job_id as string))
  const removable: string[] = []
  for (const job of jobs ?? []) {
    if (job.status === "completed") result.completed++
    else if (stocked.has(job.id)) result.withStock++
    else removable.push(job.id)
  }
  if (removable.length > 0) {
    const { data: deleted, error: deleteError } = await supabase.from("schedule_jobs").delete().in("id", removable).neq("status", "completed").select("id")
    if (deleteError) throw deleteError
    result.cleared = deleted?.length ?? 0
  }
  return result
}

export async function linkVisitToScheduleJob(
  table: "filter_change_plans" | "install_plans" | "repair_plans" | "collections",
  recordId: string,
  jobId: string
): Promise<void> {
  const { error } = await supabase.from(table).update({ schedule_job_id: jobId }).eq("id", recordId).is("schedule_job_id", null)
  if (error) throw error
}

// Moves an unscheduled visit (no job yet) to another day — its planned date
// (Pre D / Pre Installed Date) — and records the Saturday it came from.
const VISIT_DATE_COLUMN = {
  filter_change_plans: "pre_d",
  install_plans: "pre_installed_date",
  repair_plans: "pre_d",
  collections: "pre_d",
} as const

export async function rescheduleVisit(
  table: keyof typeof VISIT_DATE_COLUMN,
  recordId: string,
  date: string,
  rescheduledFrom: string
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ [VISIT_DATE_COLUMN[table]]: date, rescheduled_from: rescheduledFrom })
    .eq("id", recordId)
  if (error) throw error
}

export async function deleteScheduleJob(id: string): Promise<void> {
  const { error } = await supabase.from("schedule_jobs").delete().eq("id", id)
  if (error) throw error
}

// Same preview-then-apply shape as filter-change-plans.ts's own
// TechnicianSuggestion/BulkSuggestionResult — see schedule-job-suggest.ts
// for the underlying logic these two routes call. Only the bulk path is
// exposed here — the Schedule page's "Auto-suggest technicians" is the one
// toolbar-level feature asked for, matching Filter Change's own toolbar
// button; there's no per-record single-suggest UI on this page to back a
// single-job endpoint.
export interface TechnicianSuggestion {
  technician: string
  distanceKm: number | null
  nearbyCount: number
  explanation: string
  outsideCoverage: boolean
}

export interface BulkSuggestionResult {
  jobId: string
  result: TechnicianSuggestion | { error: string }
}

export async function previewTechnicianSuggestionsForJobs(jobIds: string[]): Promise<BulkSuggestionResult[]> {
  const res = await fetch("/api/schedule-jobs/suggest-technician-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to preview technician suggestions")
  return data.results as BulkSuggestionResult[]
}

// Job details editable in the Auto-suggest modal, and custom errands added
// there — same shapes as schedule-job-suggest.ts's own (server-only, so
// redeclared here rather than imported).
export interface ScheduleJobEdits {
  jobType?: ScheduleJobType
  scheduledDate?: string
  scheduledTime?: string
  secondaryAddress?: string
  notes?: string
  filterCodes?: string
  repairIssue?: string
}

// A custom errand (jobType "other") or an additional task bundled onto a
// job's visit — see schedule-job-suggest.ts's NewScheduleJob.
export interface ScheduleNewJob {
  jobType?: ScheduleJobType
  customerId?: string
  orderNo?: string
  technician: string
  technician2?: string
  scheduledDate: string
  scheduledTime?: string
  address?: string
  notes: string
  filterCodes?: string
}

export type ApplyAssignmentsResult = { applied: number; jobsCreated: number; failed: string[]; unlinked: string[] }

export async function applyTechnicianAssignmentsToJobs(
  assignments: { jobId: string; technician: string; technician2?: string; changes?: ScheduleJobEdits }[],
  newJobs: ScheduleNewJob[] = []
): Promise<ApplyAssignmentsResult> {
  const res = await fetch("/api/schedule-jobs/suggest-technician-apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignments, newJobs }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to assign technicians")
  return data as ApplyAssignmentsResult
}

// "Clear Schedule" / "Unassign All" for a date — deletes every schedule_jobs
// row on that date and blanks the linked filter_change_plans/collections/
// repair_plans row's own technician columns (see clear-schedule.ts), so the
// date is back to a clean slate for a fresh Draft Assignments Generate run.
export async function clearScheduleForDate(targetDate: string): Promise<{ jobsCleared: number; plansUnlinked: number }> {
  const res = await fetch("/api/schedule-jobs/clear-schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetDate }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to clear schedule")
  return data as { jobsCleared: number; plansUnlinked: number }
}

// Batch "Mark as Completed" (Schedule full-screen view) — see
// src/lib/scheduling/complete-jobs.ts for what it does to linked records
// and the inventory queue.
export type CompleteJobsResult = { completed: number; filterChangeVisits: number; installs: number; repairs: number; collections: number; queuedFromJobs: number }

export async function completeScheduleJobs(jobIds: string[], today: string): Promise<CompleteJobsResult> {
  const res = await fetch("/api/schedule-jobs/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobIds, today }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to complete jobs")
  return data as CompleteJobsResult
}
