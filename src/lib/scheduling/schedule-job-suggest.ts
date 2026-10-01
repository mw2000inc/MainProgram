import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveViaCustomer, pickBestTechnician, computeRouteSequence, type SameDayJobRow, type TechnicianPick } from "./smart-schedule"
import type { GeoPoint } from "@/lib/nominatim-server"
import { isAssignedTechnician, matchTechnicianAccount, normalizeTechnicianPair, type TechnicianAccount } from "@/lib/technicians"

// The Schedule page's own "Auto-suggest technicians" toolbar button — same
// preview-then-apply design as filter-change-suggest.ts (previewSuggestionsForJobs
// computes without writing; the admin reviews/edits each pick in the confirm
// dialog; applyTechnicianAssignmentsToJobs writes exactly what's shown —
// running this at all, over the jobs the admin is already looking at, is the
// confirmation, the same way clicking "Run now" on an automation is), but
// scored via pickBestTechnician() from smart-schedule.ts directly rather
// than a second copy of that heuristic: unlike filter_change_plans (no
// schedule_jobs row of its own to score against, hence that file's own
// scoreTechnicians()), a schedule_jobs row already has everything
// pickBestTechnician() needs — cached latitude/longitude, scheduled_date,
// route_sequence — the exact same shape autoAssignScheduleJob() already
// scores against for the real-time auto-assign-on-confirm path.
// TechnicianSuggestion's shape is reused from that file rather than
// redefined, purely as this module's own internal scoring result — there's
// no per-record single-suggest UI on this page to expose it to, unlike
// Filter Change's own edit-form Sparkles button.
import type { TechnicianSuggestion } from "./filter-change-suggest"
import type { ScheduleJobType } from "@/lib/types"

// Same threshold filter-change-suggest.ts uses for its own outsideCoverage
// flag — kept as a local constant rather than a shared export since it's a
// display-only judgment call, not part of the actual scoring math.
const OUTSIDE_COVERAGE_KM = 15

interface JobRow {
  id: string
  // Only actually selected (and meaningful) at applyTechnicianAssignmentsToJobs's
  // own call site, for its compare-and-swap write guard — previewSuggestionsForJobs
  // casts through this same shared shape but never reads this field.
  technician?: string
  // Same as technician above — only selected/read at applyTechnicianAssignmentsToJobs's
  // own call site, for the same compare-and-swap guard now that the write
  // touches this column too.
  technician_2?: string
  customer_id: string | null
  scheduled_date: string
  latitude: number | null
  longitude: number | null
  // Only selected (and meaningful) at applyTechnicianAssignmentsToJobs's own
  // call site, to decide which source plan table (if any) to mirror the
  // accepted technician assignment onto — see syncTechnicianToSourcePlan.
  job_type?: string
}

// Which source plan table (if any) a schedule_jobs row was created for, and
// that table's own technician column names — filter_change_plans/collections
// use serviceman/serviceman_2 (20260914000000_collection_install_technician_column.sql),
// repair_plans uses its own original th/th_2 naming
// (20261003000000_second_technician.sql). installation/monitoring/other are
// deliberately not mapped: install_plans wasn't part of this sync's scope,
// and monitoring/other have no source plan table at all. vehicle is
// deliberately never mirrored here — none of these plan tables have a
// vehicle column; it stays a schedule_jobs/dispatch-only concept.
const SOURCE_PLAN_BY_JOB_TYPE: Partial<Record<string, { table: string; primaryColumn: string; secondaryColumn: string }>> = {
  filter_change: { table: "filter_change_plans", primaryColumn: "serviceman", secondaryColumn: "serviceman_2" },
  collection: { table: "collections", primaryColumn: "serviceman", secondaryColumn: "serviceman_2" },
  repair: { table: "repair_plans", primaryColumn: "th", secondaryColumn: "th_2" },
}

// Best-effort mirror of an accepted assignment onto whichever plan row (if
// any) this schedule_jobs row was created for — a plan row only links back
// here (via its own schedule_job_id) once a customer confirmed it or an
// admin manually created this schedule_jobs row from one
// (find_or_create_schedule_job's own dedupe key), so "no matching row" is a
// normal, silent no-op here, not an error. Never blocks or fails the
// schedule_jobs write itself — same "a secondary sync never fails the
// primary action" principle the push-notification send already follows
// elsewhere in this app (push-opt-in-banner.tsx).
async function syncTechnicianToSourcePlan(
  admin: SupabaseClient,
  jobType: string | undefined,
  jobId: string,
  technician: string,
  technician2: string
): Promise<void> {
  const mapping = jobType ? SOURCE_PLAN_BY_JOB_TYPE[jobType] : undefined
  if (!mapping) return
  await admin
    .from(mapping.table)
    .update({ [mapping.primaryColumn]: technician, [mapping.secondaryColumn]: technician2 })
    .eq("schedule_job_id", jobId)
}

type LocationSource = "cached" | "customer_cached" | "customer_geocoded" | "unavailable"

// geocodeWithFallback (nominatim-server.ts) can legitimately take up to
// ~10 candidate attempts spaced 1.1s apart (Nominatim's own rate limit) plus
// a final city-level attempt — up to ~12s for a single hard-to-resolve
// address, with no timeout of its own. That's the right tradeoff for its
// OTHER callers (a saved customer address, a directions lookup) where a few
// extra seconds for a materially better match is worth it and nothing is
// waiting on an open dialog. It is NOT the right tradeoff here: an admin is
// looking at an open "Auto-suggest technicians" modal, and pickBestTechnician
// already has a graceful, real fallback (round-robin by workload) for a job
// whose location can't be resolved — there's no reason a slow geocode should
// ever block that fallback from kicking in quickly. Scoped to resolveJobPoint
// below ONLY (not resolveViaCustomer/geocodeWithFallback themselves), so
// autoAssignScheduleJob's own real-time background path — which has no UI
// waiting on it — keeps its full, unhurried attempt.
const GEOCODE_TIMEOUT_MS = 1500

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

// Losing a race here doesn't cancel resolveViaCustomer's own in-flight fetch
// (JS promises can't be cancelled) — it keeps running in the background and,
// if it later succeeds, still caches the result onto the customer row via
// its own update call, same as always. That's a deliberate, accepted
// trade-off: this preview/apply call moves on immediately either way, and a
// slow lookup that finishes after the timeout still "pays off" for the next
// time anyone needs this same customer's location — it just doesn't block
// THIS one. Losing this race is normal now, not exceptional: confirmed live
// that geocodeWithFallback getting even ONE attempt within 1.5s only happens
// for the fastest single Nominatim round-trip — any retry candidate (each
// gated by its own 1.1s sleep) will essentially always run past this
// deadline.
async function resolveJobPoint(admin: SupabaseClient, job: JobRow): Promise<{ point: GeoPoint | null; source: LocationSource }> {
  if (job.latitude != null && job.longitude != null) {
    return { point: { lat: job.latitude, lon: job.longitude }, source: "cached" }
  }
  if (!job.customer_id) return { point: null, source: "unavailable" }
  const { point, source } = await withTimeout(
    resolveViaCustomer(admin, job.customer_id, "customer_cached", "customer_geocoded"),
    GEOCODE_TIMEOUT_MS,
    { point: null, source: "unavailable" as const }
  )
  // resolveViaCustomer's own return type is the full LocationSource union
  // (it's shared with install/repair paths that don't apply here) — with
  // only "customer_cached"/"customer_geocoded" ever passed in as the two
  // real outcomes, the actual value is always one of those two or
  // "unavailable" (the point-null case, handled explicitly below).
  return { point, source: point ? (source as "customer_cached" | "customer_geocoded") : "unavailable" }
}

// `simulated` overrides a same-day job's real technician with an in-memory
// pick — how previewSuggestionsForJobs below lets later jobs in the same
// batch see earlier ones as already-assigned neighbors without writing
// anything to the database yet. Every job in the window is fetched
// regardless of its own current technician (a still-blank one might have a
// simulated pick to apply), unlike a plain "already assigned" filter.
async function fetchSameDayJobs(
  admin: SupabaseClient,
  jobId: string,
  scheduledDate: string,
  simulated?: Map<string, string>
): Promise<SameDayJobRow[]> {
  const { data } = await admin
    .from("schedule_jobs")
    .select("id, technician, technician_2, latitude, longitude, route_sequence, order_no")
    .eq("scheduled_date", scheduledDate)
    .neq("status", "cancelled")
    .neq("id", jobId)
  const rows = (data ?? []) as SameDayJobRow[]
  if (!simulated) return rows
  return rows.map((row) => (simulated.has(row.id) ? { ...row, technician: simulated.get(row.id)! } : row))
}

// locationUnresolved distinguishes "this job's OWN location couldn't be
// resolved at all, so this is a pure round-robin/workload pick" from the
// pre-existing "we know where this job is, we just don't have a nearby
// same-day job to compare it against yet" case — both leave minDistanceKm
// null, but only the former should suppress the "Outside usual coverage"
// badge (that badge means "we measured a real distance and it's far,"
// which isn't true when there was nothing to measure at all) and get its
// own, more honest explanation string.
//
// sameDayJobs is passed through purely to resolve pick.nearestJobId into a
// human-readable order number for the "Clustered with Order #X" wording —
// pickBestTechnician itself only ever deals in ids/distances, never labels
// (see its own comment on SameDayJobRow.order_no being optional there).
function toSuggestion(pick: TechnicianPick, locationUnresolved: boolean, sameDayJobs: SameDayJobRow[]): TechnicianSuggestion {
  const outsideCoverage = !locationUnresolved && (pick.minDistanceKm === null || pick.minDistanceKm > OUTSIDE_COVERAGE_KM)
  const nearestJob = pick.nearestJobId ? sameDayJobs.find((j) => j.id === pick.nearestJobId) : undefined
  const nearestOrderLabel = nearestJob?.order_no?.trim() ? `Order #${nearestJob.order_no.trim()}` : "a nearby job"
  const explanation = locationUnresolved
    ? `This job's location couldn't be resolved (no cached coordinates, and no linked customer with a usable address) — ${pick.technician} picked by workload balance (${pick.jobCount} job(s) already assigned that day) instead of proximity.`
    : pick.minDistanceKm != null
      ? `Clustered with ${nearestOrderLabel} (${pick.minDistanceKm.toFixed(1)} km away) — ${pick.technician} already has ${pick.jobCount} job(s) that day.`
      : `No technician has a located job that day yet — ${pick.technician} picked as the least-loaded option.`
  return { technician: pick.technician, distanceKm: pick.minDistanceKm, nearbyCount: pick.jobCount, explanation, outsideCoverage }
}

export interface BulkSuggestionResult {
  jobId: string
  result: TechnicianSuggestion | { error: string }
}

// Read-only: computes a suggestion for every job in the batch, without
// writing anything — the admin reviews (and can override) each one in the
// confirm dialog before anything is actually saved.
//
// Two phases, not one sequential loop:
//
// Phase 1 (concurrent, Promise.all) resolves every job's row and location —
// the only slow, I/O-bound step per job (a DB read, and for a customer with
// no cached coordinates, a live geocode — see GEOCODE_TIMEOUT_MS above).
// None of this depends on any OTHER job in the batch, so there's no reason
// to pay each job's latency one after another: a batch of 26 jobs used to
// mean up to 26 sequential geocode waits; now the slowest single one bounds
// the whole phase.
//
// Phase 2 (sequential, unchanged from before) scores each job in order,
// simulating each successful pick in memory (simulated map) so later jobs
// in the same batch still see earlier ones as already-assigned neighbors —
// the exact same within-run clustering the old blind bulk-write produced.
// This genuinely can't be parallelized: job N's score depends on the
// `simulated` map job N-1 just wrote to. It stays cheap even at 26 jobs
// because every point was already resolved in phase 1 — nothing left in
// this loop is slow I/O, just one more DB read (fetchSameDayJobs) and pure
// computation. Nothing is written to the database until
// applyTechnicianAssignmentsToJobs is explicitly called afterward.
export async function previewSuggestionsForJobs(admin: SupabaseClient, jobIds: string[]): Promise<BulkSuggestionResult[]> {
  const resolved = await Promise.all(
    jobIds.map(async (jobId) => {
      const { data: job } = await admin
        .from("schedule_jobs")
        .select("id, customer_id, scheduled_date, latitude, longitude")
        .eq("id", jobId)
        .maybeSingle()
      if (!job) return { jobId, job: null }
      // No early bail-out when the point can't be resolved —
      // pickBestTechnician (smart-schedule.ts) accepts a null point
      // precisely for this case and falls back to a workload-balanced
      // (round-robin) pick, so a job with absolutely no location signal
      // still gets a real, applicable suggestion instead of an unfillable
      // error — see that function's own comment.
      const { point } = await resolveJobPoint(admin, job as JobRow)
      return { jobId, job: job as JobRow, point }
    })
  )

  const results: BulkSuggestionResult[] = []
  const simulated = new Map<string, string>()
  for (const { jobId, job, point } of resolved) {
    if (!job) {
      results.push({ jobId, result: { error: "Job not found." } })
      continue
    }
    const sameDayJobs = await fetchSameDayJobs(admin, jobId, job.scheduled_date, simulated)
    const pick = pickBestTechnician(point ?? null, sameDayJobs)
    const suggestion = toSuggestion(pick, point == null, sameDayJobs)
    simulated.set(jobId, suggestion.technician)
    results.push({ jobId, result: suggestion })
  }
  return results
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const JOB_TYPES = new Set<ScheduleJobType>(["installation", "filter_change", "repair", "collection", "monitoring", "other"])

// Job details an admin can change in the Auto-suggest modal before
// confirming. Only the keys present are written; each is checked here at
// the write boundary rather than trusted from the client.
export interface JobEdits {
  jobType?: ScheduleJobType
  scheduledDate?: string
  scheduledTime?: string
  secondaryAddress?: string
  notes?: string
  filterCodes?: string
  // A repair job's issue ("Leaking fittings"). Already folded into notes by
  // the client; sent separately only so a linked repair record with a blank
  // Problem can be given it too.
  repairIssue?: string
}

export interface JobAssignment {
  jobId: string
  technician: string
  technician2?: string
  changes?: JobEdits
}

// A job created in the modal: a custom errand ("Pick up filters from the
// warehouse" — jobType "other", no customer, notes is the task so it's
// required), or an additional task bundled onto an existing job's visit
// (e.g. a Collection alongside a Filter Change — same customer, order, date,
// address and technicians as that job, its own type/notes/filters).
export interface NewScheduleJob {
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

function jobEditColumns(changes: JobEdits | undefined): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (!changes) return row
  if (changes.jobType !== undefined && JOB_TYPES.has(changes.jobType)) row.job_type = changes.jobType
  if (changes.scheduledDate !== undefined && ISO_DATE.test(changes.scheduledDate)) row.scheduled_date = changes.scheduledDate
  if (changes.scheduledTime !== undefined) row.scheduled_time = changes.scheduledTime.trim() || null
  if (changes.secondaryAddress !== undefined) row.secondary_address = changes.secondaryAddress.trim() || null
  if (changes.notes !== undefined) row.notes = changes.notes.trim() || null
  if (changes.filterCodes !== undefined) row.filter_codes = changes.filterCodes.trim()
  return row
}

// Writes exactly what's given — no scoring, no recomputation. Called only
// after the admin has reviewed (and possibly overridden) the preview above.
// Also saves any job details edited in the modal, and creates any custom
// errands added there, in the same Confirm & Assign.
//
// Same two-phase split as previewSuggestionsForJobs above, for the same
// reason: resolving each job's row/point (a DB read, and possibly a
// timeout-bounded live geocode) is independent per job, so it runs
// concurrently; computing route_sequence and writing it is NOT independent
// — it has to see each technician's REAL same-day jobs (not the preview's
// simulated state) INCLUDING any assignment already committed earlier in
// this same run, so an override that changes who a job goes to still lands
// in the right spot in *that* technician's day. That part stays sequential.
export async function applyTechnicianAssignmentsToJobs(
  admin: SupabaseClient,
  assignments: JobAssignment[],
  newJobs: NewScheduleJob[] = []
): Promise<{ applied: number; jobsCreated: number; failed: string[]; unlinked: string[] }> {
  // Each technician's login, so the job reaches their own Daily Report (see
  // matchTechnicianAccount) — the name alone never did.
  const { data: accountRows } = await admin.from("profiles").select("id, name").eq("role", "technician")
  const accounts = (accountRows ?? []) as TechnicianAccount[]
  const unlinked = new Set<string>()
  // Real database errors (not the silent "someone else assigned it first"
  // no-op), so a failed save is reported instead of counted as nothing.
  const failed: string[] = []
  const resolved = await Promise.all(
    assignments
      .filter(({ technician }) => technician.trim())
      .map(async ({ jobId, technician, technician2, changes }) => {
        const { data: job } = await admin
          .from("schedule_jobs")
          .select("id, technician, technician_2, customer_id, scheduled_date, latitude, longitude, job_type")
          .eq("id", jobId)
          .maybeSingle()
        // Someone else (another admin, or a prior run) already gave this job
        // a real assignment since the preview was computed — leave it
        // alone, same "no-op on a genuine race" intent the compare-and-swap
        // write below always had. Keyed on the PRIMARY only, matching every
        // other "is this job assigned" check in this feature (isAssignedTechnician,
        // unassignedInView) — the second technician is always supplementary,
        // never itself what decides whether a job counts as assigned.
        if (!job || isAssignedTechnician(job.technician)) return { jobId, technician, technician2, changes, job: null }
        const { point, source } = await resolveJobPoint(admin, job as JobRow)
        return { jobId, technician, technician2, changes, job: job as JobRow, point, source }
      })
  )

  let applied = 0
  for (const { jobId, technician, technician2, changes, job, point, source } of resolved) {
    if (!job) continue

    // Same normalization every other technician-pair write path in this app
    // runs just before persisting (ScheduleFormDialog's own onSubmit, via
    // technicianPairOf) — drops a second technician that duplicates the
    // first, or that was typed without a real primary. Not redundant with
    // InlineTechnicianPairCell's own client-side normalization: this is a
    // second, server-side pass at the actual write boundary, the same way
    // every other write path here treats that boundary as worth guarding
    // rather than trusting whatever the client last sent.
    const { primary: normalizedTechnician, secondary: normalizedTechnician2 } = normalizeTechnicianPair(technician, technician2 ?? "")

    const account = matchTechnicianAccount(normalizedTechnician, accounts)
    const account2 = normalizedTechnician2 ? matchTechnicianAccount(normalizedTechnician2, accounts) : undefined
    const update: Record<string, unknown> = {
      technician: normalizedTechnician,
      technician_2: normalizedTechnician2,
      technician_user_id: account?.id ?? null,
      technician_2_user_id: account2?.id ?? null,
      ...jobEditColumns(changes),
    }
    const scheduledDate = changes?.scheduledDate ?? job.scheduled_date
    if (point) {
      const sameDayJobs = await fetchSameDayJobs(admin, jobId, scheduledDate)
      const technicianJobsThatDay = sameDayJobs.filter(
        (j) => j.technician === normalizedTechnician || j.technician_2 === normalizedTechnician
      )
      update.route_sequence = computeRouteSequence(point, technicianJobsThatDay)
      if (job.latitude == null || job.longitude == null) {
        update.latitude = point.lat
        update.longitude = point.lon
        update.location_source = source
      }
    }

    // Compare-and-swap against both job.technician AND job.technician_2 as
    // just read, NOT a hardcoded '' — confirmed live that most "unassigned"
    // schedule_jobs actually hold the roster's own "N/A" placeholder
    // (written by the filter-change-schedule cron), not true blank. The old
    // .eq("technician", "") guard silently matched zero rows for every one
    // of those — no error, but nothing written either, while this still
    // counted as "applied" purely because the call didn't error. Guarding
    // technician_2 too now that this write touches it: the same "don't
    // clobber a concurrent edit" intent the primary guard always had, now
    // covering the field this update newly writes. .select() + checking the
    // returned row makes `applied` reflect what actually changed, not just
    // "no error."
    // technician_2 is NULL (not '') on every cron-generated job — confirmed
    // live: all 26 unassigned pending jobs. `.eq("technician_2", "")` never
    // matches NULL in SQL, so the guard has to test for NULL explicitly or
    // Confirm & Assign silently saves nothing for those jobs.
    let guarded = admin.from("schedule_jobs").update(update).eq("id", jobId).eq("technician", job.technician)
    guarded = job.technician_2 == null ? guarded.is("technician_2", null) : guarded.eq("technician_2", job.technician_2)
    const { data: updated, error } = await guarded.select("id")
    if (error) failed.push(`job ${jobId}: ${error.message}`)
    if (!error && updated && updated.length > 0) {
      applied += 1
      if (!account) unlinked.add(normalizedTechnician)
      if (normalizedTechnician2 && !account2) unlinked.add(normalizedTechnician2)
      await syncTechnicianToSourcePlan(admin, job.job_type, jobId, normalizedTechnician, normalizedTechnician2)
      // A job created for a Filter Change visit keeps that visit's own
      // Filter in step with what was just set here.
      if (changes?.filterCodes !== undefined) {
        await admin.from("filter_change_plans").update({ filter_type: changes.filterCodes }).eq("schedule_job_id", jobId)
      }
      // The repair record this job was created for keeps its own Problem
      // (what the customer reported) — only filled when it's still blank.
      if (changes?.repairIssue?.trim()) {
        await admin.from("repair_plans").update({ problem: changes.repairIssue.trim() }).eq("schedule_job_id", jobId).eq("problem", "")
      }
    }
  }

  // New jobs (errands and additional tasks) — live straight away
  // ('pending', not 'pending_approval', since the admin is confirming them
  // right here) and linked to the technician's login the same way, so they
  // land on their Daily Report. No route stop: there's no geocoded point
  // for them yet.
  let jobsCreated = 0
  for (const errand of newJobs) {
    const jobType = errand.jobType && JOB_TYPES.has(errand.jobType) ? errand.jobType : "other"
    const { primary, secondary } = normalizeTechnicianPair(errand.technician, errand.technician2 ?? "")
    if (!isAssignedTechnician(primary) || !ISO_DATE.test(errand.scheduledDate)) continue
    if (jobType === "other" && !errand.notes.trim()) continue
    const account = matchTechnicianAccount(primary, accounts)
    const account2 = secondary ? matchTechnicianAccount(secondary, accounts) : undefined
    const { error } = await admin.from("schedule_jobs").insert({
      job_type: jobType,
      customer_id: errand.customerId || null,
      order_no: errand.orderNo?.trim() || null,
      status: "pending",
      technician: primary,
      technician_2: secondary || null,
      technician_user_id: account?.id ?? null,
      technician_2_user_id: account2?.id ?? null,
      scheduled_date: errand.scheduledDate,
      scheduled_time: errand.scheduledTime?.trim() || null,
      secondary_address: errand.address?.trim() || null,
      notes: errand.notes.trim() || null,
      filter_codes: errand.filterCodes?.trim() ?? "",
      source: "auto_suggest",
    })
    if (error) {
      failed.push(`new ${jobType} job${errand.orderNo ? ` for ${errand.orderNo}` : ""}: ${error.message}`)
      continue
    }
    jobsCreated += 1
    if (!account) unlinked.add(primary)
    if (secondary && !account2) unlinked.add(secondary)
  }
  return { applied, jobsCreated, failed, unlinked: [...unlinked] }
}
