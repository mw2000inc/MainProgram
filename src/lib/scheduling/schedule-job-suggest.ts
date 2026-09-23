import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveViaCustomer, pickBestTechnician, computeRouteSequence, type SameDayJobRow, type TechnicianPick } from "./smart-schedule"
import type { GeoPoint } from "@/lib/nominatim-server"

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
  customer_id: string | null
  scheduled_date: string
  latitude: number | null
  longitude: number | null
}

type LocationSource = "cached" | "customer_cached" | "customer_geocoded" | "unavailable"

async function resolveJobPoint(admin: SupabaseClient, job: JobRow): Promise<{ point: GeoPoint | null; source: LocationSource }> {
  if (job.latitude != null && job.longitude != null) {
    return { point: { lat: job.latitude, lon: job.longitude }, source: "cached" }
  }
  if (!job.customer_id) return { point: null, source: "unavailable" }
  const { point, source } = await resolveViaCustomer(admin, job.customer_id, "customer_cached", "customer_geocoded")
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
    .select("id, technician, technician_2, latitude, longitude, route_sequence")
    .eq("scheduled_date", scheduledDate)
    .neq("status", "cancelled")
    .neq("id", jobId)
  const rows = (data ?? []) as SameDayJobRow[]
  if (!simulated) return rows
  return rows.map((row) => (simulated.has(row.id) ? { ...row, technician: simulated.get(row.id)! } : row))
}

function toSuggestion(pick: TechnicianPick): TechnicianSuggestion {
  const outsideCoverage = pick.minDistanceKm === null || pick.minDistanceKm > OUTSIDE_COVERAGE_KM
  const explanation =
    pick.minDistanceKm != null
      ? `${pick.technician} already has ${pick.jobCount} job(s) that day, nearest ${pick.minDistanceKm.toFixed(1)} km away.`
      : `No technician has a located job that day yet — ${pick.technician} picked as the least-loaded option.`
  return { technician: pick.technician, distanceKm: pick.minDistanceKm, nearbyCount: pick.jobCount, explanation, outsideCoverage }
}

export interface BulkSuggestionResult {
  jobId: string
  result: TechnicianSuggestion | { error: string }
}

// Read-only: computes a suggestion for every job in the batch, without
// writing anything — the admin reviews (and can override) each one in the
// confirm dialog before anything is actually saved. Processed sequentially,
// simulating each successful pick in memory (simulated map) so later jobs
// in the same batch still see earlier ones as already-assigned neighbors —
// the exact same within-run clustering the old blind bulk-write produced,
// just without touching the database until
// applyTechnicianAssignmentsToJobs is explicitly called afterward.
export async function previewSuggestionsForJobs(admin: SupabaseClient, jobIds: string[]): Promise<BulkSuggestionResult[]> {
  const results: BulkSuggestionResult[] = []
  const simulated = new Map<string, string>()
  for (const jobId of jobIds) {
    const { data: job } = await admin
      .from("schedule_jobs")
      .select("id, customer_id, scheduled_date, latitude, longitude")
      .eq("id", jobId)
      .maybeSingle()
    if (!job) {
      results.push({ jobId, result: { error: "Job not found." } })
      continue
    }
    const { point } = await resolveJobPoint(admin, job as JobRow)
    if (!point) {
      results.push({ jobId, result: { error: "This job has no cached location and isn't linked to a customer, so its location can't be resolved." } })
      continue
    }
    const sameDayJobs = await fetchSameDayJobs(admin, jobId, job.scheduled_date, simulated)
    const pick = pickBestTechnician(point, sameDayJobs)
    const suggestion = toSuggestion(pick)
    simulated.set(jobId, suggestion.technician)
    results.push({ jobId, result: suggestion })
  }
  return results
}

// Writes exactly what's given — no scoring, no recomputation. Called only
// after the admin has reviewed (and possibly overridden) the preview above.
// Still resolves each job's point and its FINAL chosen technician's real
// same-day jobs (not the simulated preview state) to place route_sequence
// sensibly — an override changes who the job goes to, so it has to be
// positioned in *that* technician's day, not whoever the algorithm
// originally suggested. Sequential, same as the write side of the old
// suggest-and-assign, so route_sequence positions account for assignments
// already committed earlier in this same run.
export async function applyTechnicianAssignmentsToJobs(
  admin: SupabaseClient,
  assignments: { jobId: string; technician: string }[]
): Promise<{ applied: number }> {
  let applied = 0
  for (const { jobId, technician } of assignments) {
    if (!technician.trim()) continue
    const { data: job } = await admin
      .from("schedule_jobs")
      .select("id, customer_id, scheduled_date, latitude, longitude")
      .eq("id", jobId)
      .maybeSingle()
    if (!job) continue

    const update: Record<string, unknown> = { technician }
    const { point, source } = await resolveJobPoint(admin, job as JobRow)
    if (point) {
      const sameDayJobs = await fetchSameDayJobs(admin, jobId, job.scheduled_date)
      const technicianJobsThatDay = sameDayJobs.filter((j) => j.technician === technician || j.technician_2 === technician)
      update.route_sequence = computeRouteSequence(point, technicianJobsThatDay)
      if (job.latitude == null || job.longitude == null) {
        update.latitude = point.lat
        update.longitude = point.lon
        update.location_source = source
      }
    }

    const { error } = await admin.from("schedule_jobs").update(update).eq("id", jobId).eq("technician", "")
    if (!error) applied += 1
  }
  return { applied }
}
