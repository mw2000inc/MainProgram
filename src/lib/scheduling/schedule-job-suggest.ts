import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveViaCustomer, pickBestTechnician, computeRouteSequence, type SameDayJobRow, type TechnicianPick } from "./smart-schedule"
import type { GeoPoint } from "@/lib/nominatim-server"
import { isAssignedTechnician, normalizeTechnicianPair } from "@/lib/technicians"

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

// Writes exactly what's given — no scoring, no recomputation. Called only
// after the admin has reviewed (and possibly overridden) the preview above.
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
  assignments: { jobId: string; technician: string; technician2?: string }[]
): Promise<{ applied: number }> {
  const resolved = await Promise.all(
    assignments
      .filter(({ technician }) => technician.trim())
      .map(async ({ jobId, technician, technician2 }) => {
        const { data: job } = await admin
          .from("schedule_jobs")
          .select("id, technician, technician_2, customer_id, scheduled_date, latitude, longitude")
          .eq("id", jobId)
          .maybeSingle()
        // Someone else (another admin, or a prior run) already gave this job
        // a real assignment since the preview was computed — leave it
        // alone, same "no-op on a genuine race" intent the compare-and-swap
        // write below always had. Keyed on the PRIMARY only, matching every
        // other "is this job assigned" check in this feature (isAssignedTechnician,
        // unassignedInView) — the second technician is always supplementary,
        // never itself what decides whether a job counts as assigned.
        if (!job || isAssignedTechnician(job.technician)) return { jobId, technician, technician2, job: null }
        const { point, source } = await resolveJobPoint(admin, job as JobRow)
        return { jobId, technician, technician2, job: job as JobRow, point, source }
      })
  )

  let applied = 0
  for (const { jobId, technician, technician2, job, point, source } of resolved) {
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

    const update: Record<string, unknown> = { technician: normalizedTechnician, technician_2: normalizedTechnician2 }
    if (point) {
      const sameDayJobs = await fetchSameDayJobs(admin, jobId, job.scheduled_date)
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
    const { data: updated, error } = await admin
      .from("schedule_jobs")
      .update(update)
      .eq("id", jobId)
      .eq("technician", job.technician)
      .eq("technician_2", job.technician_2 ?? "")
      .select("id")
    if (!error && updated && updated.length > 0) applied += 1
  }
  return { applied }
}
