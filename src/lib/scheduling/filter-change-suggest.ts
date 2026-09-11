import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { TECHNICIANS } from "@/lib/constants"
import { haversineKm, resolveViaCustomer } from "./smart-schedule"

// Extends the same nearest-technician heuristic smart-schedule.ts already
// uses for the customer-dispatch-confirm path (installs/repairs/
// collections) to filter_change_plans — a table that path never touches,
// since recurring filter-change plans are never linked to a schedule_jobs
// row. This is deliberately suggest-then-confirm, not silent
// auto-assignment: it never writes anything itself for a single plan (the
// route/UI layer does, via the same update path an admin's own edit would
// use); the bulk path does write, but only because an admin explicitly
// triggered that batch run, the same way "Run now" on an automation does.
//
// Clusters technician *choice* across a +-WINDOW_DAYS date window around a
// plan's own plan_date rather than moving plan_date itself -- plan_date is
// deterministically re-paced by reanchor_filter_change_schedule() whenever
// it changes, which would ripple through every future occurrence of that
// same order. Not worth that side effect just to place two nearby jobs on
// the exact same day when "same week" already gets a technician there.
const WINDOW_DAYS = 3
const WORKLOAD_PENALTY_KM = 3 // mirrors smart-schedule.ts's own constant/reasoning
const UNKNOWN_DISTANCE_BASELINE_KM = 20 // ditto
// Above this, the "best" pick still isn't a real cluster match -- just the
// least-bad option among technicians with nothing nearby. Surfaced to the
// admin as a flag rather than silently presented as a confident suggestion.
const OUTSIDE_COVERAGE_KM = 15

interface NearbyPlanRow {
  id: string
  serviceman: string
  customer_id: string | null
}

export interface TechnicianSuggestion {
  technician: string
  distanceKm: number | null
  nearbyCount: number
  explanation: string
  outsideCoverage: boolean
}

function windowDates(planDate: string): { from: string; to: string } {
  const d = new Date(`${planDate}T00:00:00Z`)
  const from = new Date(d)
  from.setUTCDate(from.getUTCDate() - WINDOW_DAYS)
  const to = new Date(d)
  to.setUTCDate(to.getUTCDate() + WINDOW_DAYS)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function scoreTechnicians(
  point: { lat: number; lon: number },
  nearby: { technician: string; lat: number; lon: number }[]
): TechnicianSuggestion {
  const roster = TECHNICIANS.filter((t) => t !== "N/A")
  const picks = roster.map((technician) => {
    const jobs = nearby.filter((j) => j.technician === technician)
    let minDistanceKm: number | null = null
    for (const job of jobs) {
      const d = haversineKm(point, { lat: job.lat, lon: job.lon })
      if (minDistanceKm === null || d < minDistanceKm) minDistanceKm = d
    }
    return { technician, minDistanceKm, jobCount: jobs.length }
  })

  picks.sort((a, b) => {
    const scoreA = (a.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) + a.jobCount * WORKLOAD_PENALTY_KM
    const scoreB = (b.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) + b.jobCount * WORKLOAD_PENALTY_KM
    if (scoreA !== scoreB) return scoreA - scoreB
    return roster.indexOf(a.technician) - roster.indexOf(b.technician)
  })

  const best = picks[0]
  const outsideCoverage = best.minDistanceKm === null || best.minDistanceKm > OUTSIDE_COVERAGE_KM
  const explanation =
    best.minDistanceKm != null
      ? `${best.technician} already has ${best.jobCount} job(s) within ${WINDOW_DAYS} days of this date, nearest ${best.minDistanceKm.toFixed(1)} km away.`
      : `No technician has a nearby job within ${WINDOW_DAYS} days of this date — ${best.technician} picked as the least-loaded option.`

  return {
    technician: best.technician,
    distanceKm: best.minDistanceKm,
    nearbyCount: best.jobCount,
    explanation,
    outsideCoverage,
  }
}

// Resolves every other filter_change_plans row already assigned to a
// technician within the date window, with a usable point (their own cached
// lat/lon, resolved via the customer the same way as the target plan —
// never geocoded on the fly here, since only the plan actually being
// suggested for is worth spending a Nominatim call on; an unresolvable
// neighbor just doesn't contribute to any technician's score).
async function fetchNearbyAssignedPlans(
  admin: SupabaseClient,
  planId: string,
  planDate: string
): Promise<{ technician: string; lat: number; lon: number }[]> {
  const { from, to } = windowDates(planDate)
  const { data } = await admin
    .from("filter_change_plans")
    .select("id, serviceman, customer_id")
    .neq("id", planId)
    .neq("serviceman", "")
    .gte("plan_date", from)
    .lte("plan_date", to)
  const rows = (data ?? []) as NearbyPlanRow[]

  const result: { technician: string; lat: number; lon: number }[] = []
  for (const row of rows) {
    if (!row.customer_id) continue
    const { data: customer } = await admin
      .from("customers")
      .select("latitude, longitude")
      .eq("id", row.customer_id)
      .maybeSingle()
    if (typeof customer?.latitude === "number" && typeof customer?.longitude === "number") {
      result.push({ technician: row.serviceman, lat: customer.latitude, lon: customer.longitude })
    }
  }
  return result
}

export async function suggestTechnicianForPlan(
  admin: SupabaseClient,
  planId: string
): Promise<TechnicianSuggestion | { error: string }> {
  const { data: plan } = await admin
    .from("filter_change_plans")
    .select("id, plan_date, customer_id")
    .eq("id", planId)
    .maybeSingle()
  if (!plan) return { error: "Plan not found." }
  if (!plan.customer_id) return { error: "This plan isn't linked to a customer record, so its location can't be resolved." }

  const { point } = await resolveViaCustomer(admin, plan.customer_id, "customer_cached", "customer_geocoded")
  if (!point) return { error: "Could not resolve this customer's location (no cached coordinates and geocoding failed)." }

  const nearby = await fetchNearbyAssignedPlans(admin, planId, plan.plan_date)
  return scoreTechnicians(point, nearby)
}

export interface BulkSuggestionResult {
  planId: string
  result: TechnicianSuggestion | { error: string }
}

// Writes serviceman immediately after each successful suggestion (rather
// than computing every suggestion first and writing them all at the end) so
// later plans in the same run see earlier ones as already-assigned
// neighbors — a batch of previously all-empty nearby plans should cluster
// onto the same technician *within* that one run, not just against
// pre-existing assignments from before it started. Running this route at
// all is the admin's confirmation (same as clicking "Run now" on an
// automation) — that's what makes writing directly here consistent with
// this feature's suggest-then-confirm design elsewhere.
export async function suggestAndAssignBulk(admin: SupabaseClient, planIds: string[]): Promise<BulkSuggestionResult[]> {
  const results: BulkSuggestionResult[] = []
  for (const planId of planIds) {
    const result = await suggestTechnicianForPlan(admin, planId)
    if (!("error" in result)) {
      await admin.from("filter_change_plans").update({ serviceman: result.technician }).eq("id", planId)
    }
    results.push({ planId, result })
  }
  return results
}
