import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { geocodeWithFallback, type GeoPoint } from "@/lib/nominatim-server"
import { TECHNICIANS } from "@/lib/constants"

// Smart Automatic Scheduling System.
//
// Runs once, right after find_or_create_schedule_job() creates a brand-new
// schedule_jobs row for a customer's genuine 'confirm' (or an admin's
// accept of a requested reschedule that has no existing linked job yet —
// see accept_requested_reschedule's own "only when no job is linked yet"
// branch). Never runs against an existing/admin-touched row: the very
// first thing this does is check the row is still exactly as
// find_or_create_schedule_job left it (technician '', location_source
// null) and bails out otherwise — an admin who has already assigned this
// job manually (or a job this already ran on before) is left completely
// alone. That single check is what makes the whole thing idempotent and
// safe to call from more than one place.
//
// This has to live here, in a route-called TS module, rather than as more
// SQL bolted onto find_or_create_schedule_job itself: geocoding a fresh
// address means an outbound HTTP call to Nominatim, and Postgres has no
// path to make one (see auto_create_schedule_job_on_confirm's own comment
// on why anything requiring a real HTTP call already has to live in a
// route). The actual DB write this ends with is a followup UPDATE, which
// restrict_schedule_job_technician_update now explicitly allows for a
// service-role caller (see allow_backend_schedule_job_assignment) —
// everything else about that trigger's protection is unchanged.
//
// Two tunable weights below (WORKLOAD_PENALTY_KM, UNKNOWN_DISTANCE_BASELINE_KM)
// are just scoring constants for the greedy heuristic, not real data about
// any technician — this app has no day-off, capacity, or skill data for
// technicians (confirmed gap, not invented here), so those two numbers are
// the only knobs available to balance "closest" against "already busy."

const WORKLOAD_PENALTY_KM = 3 // each existing job that day nudges a technician's score, so one very central technician doesn't silently absorb the whole day
const UNKNOWN_DISTANCE_BASELINE_KM = 20 // treat "no located job to compare against yet" as roughly this far, not as infinitely close or infinitely far

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"
export type ScheduleJobTypeDb = "installation" | "filter_change" | "repair" | "collection" | "monitoring" | "other"

export type LocationSource = "customer_cached" | "customer_geocoded" | "install_geocoded" | "repair_via_customer" | "unavailable"

interface ResolvedLocation {
  point: GeoPoint | null
  source: LocationSource
}

function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Resolves a customer's point, geocoding + caching onto customers.latitude/
// longitude (the same write-path the Member List map panel already uses,
// see updateCustomerCoordinates in src/lib/api/customers.ts) if it isn't
// cached yet. Shared by the filter_change/collection path and, once a
// repair has been traced back to a customer, the repair path too.
async function resolveViaCustomer(
  admin: SupabaseClient,
  customerId: string,
  sourceIfCached: LocationSource,
  sourceIfGeocoded: LocationSource
): Promise<ResolvedLocation> {
  const { data: customer } = await admin
    .from("customers")
    .select("latitude, longitude, address")
    .eq("id", customerId)
    .maybeSingle()
  if (!customer) return { point: null, source: "unavailable" }

  if (typeof customer.latitude === "number" && typeof customer.longitude === "number") {
    return { point: { lat: customer.latitude, lon: customer.longitude }, source: sourceIfCached }
  }

  if (!customer.address) return { point: null, source: "unavailable" }
  const point = await geocodeWithFallback(customer.address)
  if (!point) return { point: null, source: "unavailable" }

  // Cache it back exactly like the map panel does, so the next job for this
  // same customer (or the map panel itself) doesn't need to re-geocode.
  await admin.from("customers").update({ latitude: point.lat, longitude: point.lon }).eq("id", customerId)
  return { point, source: sourceIfGeocoded }
}

async function resolveJobLocation(
  admin: SupabaseClient,
  jobType: ScheduleJobTypeDb,
  entityType: DispatchEntityType,
  entityId: string,
  customerId: string | null,
  orderNo: string | null
): Promise<ResolvedLocation> {
  if (entityType === "filter_change_plans" || entityType === "collections") {
    if (!customerId) return { point: null, source: "unavailable" }
    return resolveViaCustomer(admin, customerId, "customer_cached", "customer_geocoded")
  }

  if (entityType === "install_plans") {
    const { data: install } = await admin
      .from("install_plans")
      .select("latitude, longitude, address")
      .eq("id", entityId)
      .maybeSingle()
    if (!install) return { point: null, source: "unavailable" }
    if (typeof install.latitude === "number" && typeof install.longitude === "number") {
      return { point: { lat: install.latitude, lon: install.longitude }, source: "install_geocoded" }
    }
    if (!install.address) return { point: null, source: "unavailable" }
    const point = await geocodeWithFallback(install.address)
    if (!point) return { point: null, source: "unavailable" }
    await admin.from("install_plans").update({ latitude: point.lat, longitude: point.lon }).eq("id", entityId)
    return { point, source: "install_geocoded" }
  }

  if (entityType === "repair_plans") {
    // repair_plans has neither customer_id nor an address of its own (see
    // auto_create_schedule_job_on_confirm's own comment) -- the only way
    // back to a real location is the order number, exactly the same path
    // findCustomerByOrderNumber (customer-lookup.ts) already uses: prefer
    // sale_list_entries.customer_id, fall back to a direct customers.order_number
    // match. Both queried directly here rather than loading the full
    // arrays that TS helper expects, since this runs server-side per job,
    // not against an already-loaded customer list.
    if (!orderNo || !orderNo.trim()) return { point: null, source: "unavailable" }
    const trimmed = orderNo.trim()

    const { data: saleEntry } = await admin
      .from("sale_list_entries")
      .select("customer_id")
      .eq("order_number", trimmed)
      .not("customer_id", "is", null)
      .limit(1)
      .maybeSingle()
    let resolvedCustomerId = saleEntry?.customer_id as string | undefined

    if (!resolvedCustomerId) {
      const { data: directCustomer } = await admin
        .from("customers")
        .select("id")
        .eq("order_number", trimmed)
        .maybeSingle()
      resolvedCustomerId = directCustomer?.id
    }

    if (!resolvedCustomerId) return { point: null, source: "unavailable" }
    // Do NOT guess further than this -- if this customer itself has no
    // address/coordinates either, resolveViaCustomer already returns
    // 'unavailable' rather than fabricating anything.
    const resolved = await resolveViaCustomer(admin, resolvedCustomerId, "repair_via_customer", "repair_via_customer")
    return resolved
  }

  return { point: null, source: "unavailable" }
}

interface SameDayJobRow {
  id: string
  technician: string
  technician_2: string | null
  latitude: number | null
  longitude: number | null
  route_sequence: number | null
}

interface TechnicianPick {
  technician: string
  minDistanceKm: number | null
  jobCount: number
}

// Ranks every real technician (roster minus the 'N/A' placeholder) by a
// single explainable score: nearest existing job that day, penalized a
// little per job they already have that day. A technician with no located
// job yet that day (whether idle or just not yet geocoded) is scored as if
// their nearest job were UNKNOWN_DISTANCE_BASELINE_KM away, so genuinely
// idle technicians can still win over someone both far away AND already
// busy, without pretending to know a real distance for them.
function pickBestTechnician(newPoint: GeoPoint, sameDayJobs: SameDayJobRow[]): TechnicianPick {
  const roster: string[] = TECHNICIANS.filter((t) => t !== "N/A")
  const picks: TechnicianPick[] = roster.map((technician) => {
    let minDistanceKm: number | null = null
    let jobCount = 0
    for (const job of sameDayJobs) {
      const isThisTech = job.technician === technician || job.technician_2 === technician
      if (!isThisTech) continue
      jobCount += 1
      if (job.latitude != null && job.longitude != null) {
        const d = haversineKm(newPoint, { lat: job.latitude, lon: job.longitude })
        if (minDistanceKm === null || d < minDistanceKm) minDistanceKm = d
      }
    }
    return { technician, minDistanceKm, jobCount }
  })

  picks.sort((a, b) => {
    const scoreA = (a.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) + a.jobCount * WORKLOAD_PENALTY_KM
    const scoreB = (b.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) + b.jobCount * WORKLOAD_PENALTY_KM
    if (scoreA !== scoreB) return scoreA - scoreB
    // Deterministic tiebreak: earlier in the roster wins, rather than
    // whatever order the DB/array happened to return.
    return roster.indexOf(a.technician) - roster.indexOf(b.technician)
  })

  return picks[0]
}

// Greedy nearest-end insertion: a new job is placed adjacent to whichever
// END of the technician's existing route for that day it's closer to
// (before the first stop, or after the last), using a +-10 gap so no other
// row's route_sequence is ever renumbered -- an admin's already-set stop
// order for their own confirmed jobs is never touched by this. Not a full
// route re-optimization (see the feature's own report on this), just a
// reasonable place to drop a brand-new stop without disturbing anything
// that already exists.
function computeRouteSequence(newPoint: GeoPoint, technicianJobsThatDay: SameDayJobRow[]): number {
  const ordered = technicianJobsThatDay
    .filter((j) => j.route_sequence != null)
    .sort((a, b) => (a.route_sequence as number) - (b.route_sequence as number))
  if (ordered.length === 0) return 10

  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const firstPoint = first.latitude != null && first.longitude != null ? { lat: first.latitude, lon: first.longitude } : null
  const lastPoint = last.latitude != null && last.longitude != null ? { lat: last.latitude, lon: last.longitude } : null

  if (firstPoint && lastPoint) {
    const distToFirst = haversineKm(newPoint, firstPoint)
    const distToLast = haversineKm(newPoint, lastPoint)
    return distToFirst <= distToLast ? (first.route_sequence as number) - 10 : (last.route_sequence as number) + 10
  }
  // No usable coordinates on either end to compare against -- default to
  // appending at the end rather than guessing a position.
  return (last.route_sequence as number) + 10
}

const JOB_TYPE_BY_ENTITY: Record<DispatchEntityType, ScheduleJobTypeDb> = {
  filter_change_plans: "filter_change",
  install_plans: "installation",
  collections: "collection",
  repair_plans: "repair",
}

export interface ScheduleContext {
  scheduleJobId: string | null
  customerId: string | null
  orderNo: string | null
  jobType: ScheduleJobTypeDb
}

// Shared by both dispatch routes (respond, accept-reschedule): reads back
// exactly the fields find_or_create_schedule_job's own caller already wrote
// onto the entity row (schedule_job_id, order number, customer_id where
// that entity has one) — neither RPC returns these itself, so this is a
// small follow-up read rather than a change to either signature.
export async function fetchScheduleContext(admin: SupabaseClient, entityType: DispatchEntityType, entityId: string): Promise<ScheduleContext> {
  const jobType = JOB_TYPE_BY_ENTITY[entityType]
  if (entityType === "filter_change_plans") {
    const { data } = await admin.from("filter_change_plans").select("schedule_job_id, customer_id, order_number").eq("id", entityId).maybeSingle()
    return { scheduleJobId: data?.schedule_job_id ?? null, customerId: data?.customer_id ?? null, orderNo: data?.order_number ?? null, jobType }
  }
  if (entityType === "collections") {
    const { data } = await admin.from("collections").select("schedule_job_id, customer_id, order_no").eq("id", entityId).maybeSingle()
    return { scheduleJobId: data?.schedule_job_id ?? null, customerId: data?.customer_id ?? null, orderNo: data?.order_no ?? null, jobType }
  }
  if (entityType === "install_plans") {
    const { data } = await admin.from("install_plans").select("schedule_job_id, order_no").eq("id", entityId).maybeSingle()
    return { scheduleJobId: data?.schedule_job_id ?? null, customerId: null, orderNo: data?.order_no ?? null, jobType }
  }
  const { data } = await admin.from("repair_plans").select("schedule_job_id, order_no").eq("id", entityId).maybeSingle()
  return { scheduleJobId: data?.schedule_job_id ?? null, customerId: null, orderNo: data?.order_no ?? null, jobType }
}

export interface AutoAssignParams {
  scheduleJobId: string
  jobType: ScheduleJobTypeDb
  entityType: DispatchEntityType
  entityId: string
  customerId: string | null
  orderNo: string | null
  scheduledDate: string // 'YYYY-MM-DD'
}

// The orchestrator called from both dispatch routes after a genuine
// confirm/reschedule-accept. Never throws on a location/technician it can't
// resolve -- those cases are recorded honestly (location_source =
// 'unavailable', technician left blank, a note asking for admin review)
// rather than blocking the confirm the customer/admin actually asked for.
export async function autoAssignScheduleJob(admin: SupabaseClient, params: AutoAssignParams): Promise<void> {
  const { scheduleJobId, jobType, entityType, entityId, customerId, orderNo, scheduledDate } = params

  const { data: job } = await admin
    .from("schedule_jobs")
    .select("technician, location_source, notes")
    .eq("id", scheduleJobId)
    .maybeSingle()
  // Already staffed (by an admin, or a prior run of this same function) or
  // already processed once before (location_source set, even if it landed
  // on 'unavailable') -- leave it alone either way.
  if (!job || job.technician || job.location_source) return

  const { point, source } = await resolveJobLocation(admin, jobType, entityType, entityId, customerId, orderNo)

  if (!point) {
    await admin
      .from("schedule_jobs")
      .update({
        location_source: "unavailable",
        notes: job.notes || "Auto-schedule: location unavailable — needs admin review to assign a technician.",
      })
      .eq("id", scheduleJobId)
      .eq("technician", "")
    return
  }

  const { data: sameDayJobsRaw } = await admin
    .from("schedule_jobs")
    .select("id, technician, technician_2, latitude, longitude, route_sequence")
    .eq("scheduled_date", scheduledDate)
    .neq("status", "cancelled")
    .neq("id", scheduleJobId)
  const sameDayJobs = (sameDayJobsRaw ?? []) as SameDayJobRow[]

  const pick = pickBestTechnician(point, sameDayJobs)
  const technicianJobsThatDay = sameDayJobs.filter(
    (j) => j.technician === pick.technician || j.technician_2 === pick.technician
  )
  const routeSequence = computeRouteSequence(point, technicianJobsThatDay)

  const distanceNote =
    pick.minDistanceKm != null
      ? `nearest existing job for ${pick.technician} that day was ${pick.minDistanceKm.toFixed(1)} km away`
      : `${pick.technician} had no located job that day yet`
  const explanation =
    `Auto-scheduled: assigned to ${pick.technician} — ${distanceNote} ` +
    `(${pick.jobCount} existing job(s) that day). Location resolved via ${source}.`

  await admin
    .from("schedule_jobs")
    .update({
      technician: pick.technician,
      latitude: point.lat,
      longitude: point.lon,
      location_source: source,
      route_sequence: routeSequence,
      notes: job.notes || explanation,
    })
    .eq("id", scheduleJobId)
    .eq("technician", "") // no-op if something else has assigned this job in the meantime
}
