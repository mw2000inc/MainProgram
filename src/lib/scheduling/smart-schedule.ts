import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import { geocodeWithFallback, type GeoPoint } from "@/lib/nominatim-server"
import { TECHNICIANS } from "@/lib/constants"
import { haversineKm } from "./proximity"
import { createDispatchAssigner, type AssignmentSource } from "./dispatch-assignment"
import { assignmentAccounts, technicianAccountIds } from "@/lib/technicians"
import type { UnscheduledVisit } from "./unscheduled-visits"
import type { ScheduleJobType } from "@/lib/types"

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
// Multiplies minDistanceKm in the score below (WORKLOAD_PENALTY_KM stays
// unscaled) so real proximity dominates the flat per-job workload nudge
// instead of being gradually outweighed by it. Confirmed this was a real
// gap, not just a tuning nitpick: at the old 1x weight, a technician 0.5km
// away with just 3 existing jobs that day (score 0.5+3*3=9.5) already LOST
// to a completely idle technician 5km away (score 5+0=5) — a same-day
// cluster would silently break apart and start routing to a farther,
// less-loaded technician after only 2-3 stacked jobs. At 4x, that same
// 0.5km/3-job technician scores 0.5*4+9=11 against the 5km/idle
// technician's 5*4=20 — correctly keeps the cluster together. Deliberately
// NOT a hard distance cutoff or a hard per-day job cap (e.g. "max 6 jobs
// then must switch technicians") — no such limit is configured or even
// tracked anywhere in this app (confirmed: no day-off/capacity data exists
// for technicians, see this file's own top-of-file comment), so a genuine
// hard cap would mean inventing an arbitrary number with no basis. This
// keeps the existing soft, continuous heuristic but recalibrated so
// clustering wins by a wide margin for a normal-sized batch of nearby jobs,
// while workload balance still naturally reasserts itself once a
// technician's day is heavily stacked in one area (the score keeps
// climbing with every added job either way).
const DISTANCE_WEIGHT = 4

// Standing rule (not a one-time fix, confirmed with the admin): Mell,
// Butch, and Pritz are never picked by any auto-suggest/auto-assign
// algorithm, anywhere. This is the one place that pool is built —
// pickBestTechnician below (used by both autoAssignScheduleJob's real-time
// auto-assign and schedule-job-suggest.ts's admin-facing preview) and
// filter-change-suggest.ts's own scoreTechnicians both call this instead of
// filtering TECHNICIANS themselves, so the exclusion applies everywhere
// auto-suggest runs without needing to be repeated per caller. Manual
// assignment is completely untouched by this — an admin can still type or
// pick any of these three names directly into any technician field; only
// this shared candidate pool an algorithm scores from is affected.
const AUTO_SUGGEST_EXCLUDED = new Set<string>(["N/A", "Mell", "Butch", "Pritz"])

export function autoSuggestTechnicianRoster(): string[] {
  return TECHNICIANS.filter((t) => !AUTO_SUGGEST_EXCLUDED.has(t))
}

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"
export type ScheduleJobTypeDb = "installation" | "filter_change" | "repair" | "collection" | "monitoring" | "other"

export type LocationSource = "customer_cached" | "customer_geocoded" | "install_geocoded" | "repair_via_customer" | "unavailable"

export interface ResolvedLocation {
  point: GeoPoint | null
  source: LocationSource
}

export { haversineKm }

// Resolves a customer's point, geocoding + caching onto customers.latitude/
// longitude (the same write-path the Member List map panel already uses,
// see updateCustomerCoordinates in src/lib/api/customers.ts) if it isn't
// cached yet. Shared by the filter_change/collection path and, once a
// repair has been traced back to a customer, the repair path too.
// Exported so filter-change-suggest.ts's clustering can resolve a
// customer's point the exact same way (cached -> geocode -> cache back)
// instead of a second copy of this logic.
export async function resolveViaCustomer(
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

// Exported so draft-assignments.ts's own clustering (pending plan rows that
// have no schedule_jobs row of their own yet) can resolve each candidate's
// location the exact same way autoAssignScheduleJob's real-time path
// already does per entity type — one location resolver, not a fourth
// reimplementation.
export async function resolveJobLocation(
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

// Exported so schedule-job-suggest.ts's admin-triggered "Auto-suggest
// technicians" on the Schedule page can score against a schedule_jobs row
// the exact same way this module's own real-time auto-assign already does
// — one scorer, not a third reimplementation (filter_change_plans already
// has its own variant in filter-change-suggest.ts, for a table with no
// schedule_jobs row of its own to score against).
export interface SameDayJobRow {
  id: string
  technician: string
  technician_2: string | null
  latitude: number | null
  longitude: number | null
  route_sequence: number | null
  // Optional: only actually selected by schedule-job-suggest.ts's own
  // fetchSameDayJobs, to resolve nearestJobId below into a human-readable
  // "Clustered with Order #X" explanation. autoAssignScheduleJob's own
  // real-time query doesn't select it — its explanation text doesn't need
  // it — so this has to stay optional rather than required.
  order_no?: string | null
}

export interface TechnicianPick {
  technician: string
  minDistanceKm: number | null
  jobCount: number
  // The id of the same-day job that produced minDistanceKm — null whenever
  // minDistanceKm itself is null (no located same-day job to compare
  // against). Lets a caller with access to that job's own label (order
  // number) name it in the suggestion's explanation, instead of only
  // reporting a bare distance with no indication of WHICH job it's
  // clustered with.
  nearestJobId: string | null
}

// Ranks every real technician (roster minus the 'N/A' placeholder) by a
// single explainable score: nearest existing job that day, penalized a
// little per job they already have that day. A technician with no located
// job yet that day (whether idle or just not yet geocoded) is scored as if
// their nearest job were UNKNOWN_DISTANCE_BASELINE_KM away, so genuinely
// idle technicians can still win over someone both far away AND already
// busy, without pretending to know a real distance for them.
//
// newPoint is nullable for schedule-job-suggest.ts's own admin-triggered
// "Auto-suggest technicians" path: a job whose OWN location can't be
// resolved at all (no cached coordinates, no linked customer, or a customer
// with no address to geocode) has nothing to measure distance against, but
// should still get a real suggestion instead of an unfillable error — see
// that file's own comment. With newPoint null, every technician's
// minDistanceKm stays null regardless of same-day jobs' own locations,
// which the existing scoring below already treats as
// UNKNOWN_DISTANCE_BASELINE_KM — collapsing this into a pure
// workload-balance-then-roster-order pick, i.e. round-robin among whoever
// has the fewest jobs that day. autoAssignScheduleJob's own real-time path
// never passes null here (it already bails out before reaching this call
// when a job's location can't be resolved — see its own comment on why that
// separate, unattended background path is left alone).
export function pickBestTechnician(newPoint: GeoPoint | null, sameDayJobs: SameDayJobRow[]): TechnicianPick {
  const roster: string[] = autoSuggestTechnicianRoster()
  const picks: TechnicianPick[] = roster.map((technician) => {
    let minDistanceKm: number | null = null
    let nearestJobId: string | null = null
    let jobCount = 0
    for (const job of sameDayJobs) {
      const isThisTech = job.technician === technician || job.technician_2 === technician
      if (!isThisTech) continue
      jobCount += 1
      if (newPoint && job.latitude != null && job.longitude != null) {
        const d = haversineKm(newPoint, { lat: job.latitude, lon: job.longitude })
        if (minDistanceKm === null || d < minDistanceKm) {
          minDistanceKm = d
          nearestJobId = job.id
        }
      }
    }
    return { technician, minDistanceKm, jobCount, nearestJobId }
  })

  picks.sort((a, b) => {
    const scoreA = (a.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) * DISTANCE_WEIGHT + a.jobCount * WORKLOAD_PENALTY_KM
    const scoreB = (b.minDistanceKm ?? UNKNOWN_DISTANCE_BASELINE_KM) * DISTANCE_WEIGHT + b.jobCount * WORKLOAD_PENALTY_KM
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
export function computeRouteSequence(newPoint: GeoPoint, technicianJobsThatDay: SameDayJobRow[]): number {
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
// confirm/reschedule-accept (Step 2 of the dispatch pipeline — the job it
// staffs is a 'pending_approval' draft awaiting the admin's final approval).
// The technician, partner and vehicle come from the same dispatch rules as
// every other automatic assignment (createDispatchAssigner: planned
// technician, Liteace for installs, same place, customer's technician,
// nearby team, least-busy by errands; Saturdays stay unassigned). The job's
// location is still resolved first so its point is cached for routing.
// Never throws on a location it can't resolve — the job is still assigned.
export async function autoAssignScheduleJob(admin: SupabaseClient, params: AutoAssignParams): Promise<void> {
  const { scheduleJobId, jobType, entityType, entityId, orderNo, scheduledDate } = params

  const { data: job } = await admin
    .from("schedule_jobs")
    .select("technician, location_source, notes, customer_id")
    .eq("id", scheduleJobId)
    .maybeSingle()
  // Already staffed (by an admin, or a prior run of this same function) or
  // already processed once before (location_source set, even if it landed
  // on 'unavailable') -- leave it alone either way.
  if (!job || job.technician || job.location_source) return

  const visit = await visitForEntity(admin, entityType, entityId, jobType, orderNo, params.customerId ?? job.customer_id ?? null, scheduledDate)
  const { point, source } = await resolveJobLocation(admin, jobType, entityType, entityId, visit.customerId ?? null, orderNo)

  const since = new Date(Date.parse(scheduledDate) - 30 * 86_400_000).toISOString().slice(0, 10)
  const [customersRes, accountsRes, jobsRes] = await Promise.all([
    admin.from("customers").select("id, member_account_number, latitude, longitude, assigned_technician, assigned_technician_2"),
    admin.from("profiles").select("id, name, role"),
    admin
      .from("schedule_jobs")
      .select("id, customer_id, secondary_address, latitude, longitude, route_sequence, technician, technician_2, scheduled_date, status, vehicle, created_at")
      .gte("scheduled_date", since)
      .neq("id", scheduleJobId),
  ])
  const jobs = jobsRes.data ?? []
  const accounts = assignmentAccounts((accountsRes.data ?? []).map((a) => ({ id: a.id as string, name: (a.name as string) ?? "", role: a.role as string })))
  const assign = createDispatchAssigner({
    jobs: jobs.map((j) => ({
      technician: j.technician ?? "",
      technician2: j.technician_2 ?? undefined,
      scheduledDate: j.scheduled_date,
      status: j.status,
      vehicle: j.vehicle ?? "",
      createdAt: j.created_at,
      customerId: j.customer_id ?? undefined,
      secondaryAddress: j.secondary_address ?? undefined,
      latitude: j.latitude ?? undefined,
      longitude: j.longitude ?? undefined,
    })),
    customers: (customersRes.data ?? []).map((c) => ({
      id: c.id,
      assignedTechnician: c.assigned_technician ?? "",
      assignedTechnician2: c.assigned_technician_2 ?? undefined,
      memberAccountNumber: c.member_account_number ?? undefined,
      latitude: c.latitude ?? undefined,
      longitude: c.longitude ?? undefined,
    })),
    accounts,
  })
  const assignment = assign(visit, scheduledDate)
  const { primary, secondary } = assignment.pair
  const ids = technicianAccountIds(primary, secondary, accounts)

  const sameDay = jobs.filter((j) => j.scheduled_date === scheduledDate && j.status !== "cancelled") as unknown as SameDayJobRow[]
  const routeSequence =
    point && primary ? computeRouteSequence(point, sameDay.filter((j) => j.technician === primary || j.technician_2 === primary)) : null
  const team = primary ? `${primary}${secondary ? ` & ${secondary}` : ""}${assignment.vehicle ? ` (${assignment.vehicle})` : ""}` : ""
  const explanation = primary
    ? `Auto-assigned to ${team} — ${ASSIGNMENT_REASON[assignment.source]}. Awaiting final admin approval.`
    : `${assignment.source === "saturday" ? "Saturday job" : "No technician available"} — left unassigned for admin review.`

  await admin
    .from("schedule_jobs")
    .update({
      technician: primary,
      technician_2: secondary || null,
      technician_user_id: ids.technicianUserId || null,
      technician_2_user_id: ids.technician2UserId || null,
      vehicle: assignment.vehicle,
      secondary_address: visit.address ?? null,
      latitude: point?.lat ?? null,
      longitude: point?.lon ?? null,
      location_source: source,
      route_sequence: routeSequence,
      notes: job.notes || explanation,
    })
    .eq("id", scheduleJobId)
    .eq("technician", "") // no-op if something else has assigned this job in the meantime
}

const ASSIGNMENT_REASON: Record<AssignmentSource, string> = {
  planned: "the visit's planned technician",
  installation: "installations go to the Liteace team",
  location: "the team already going to the same place that day",
  customer: "the customer's assigned technician",
  nearby: "the team already working nearby that day",
  balanced: "the least-busy technician that day",
  none: "no technician available",
  saturday: "Saturday",
}

// The visit a dispatch record stands for: its address, planned technician
// and customer (install / repair records find theirs by order number).
async function visitForEntity(
  admin: SupabaseClient,
  entityType: DispatchEntityType,
  entityId: string,
  jobType: ScheduleJobTypeDb,
  orderNo: string | null,
  customerId: string | null,
  date: string
): Promise<UnscheduledVisit> {
  const { data } = await admin.from(entityType).select("*").eq("id", entityId).maybeSingle()
  const row = (data ?? {}) as Record<string, unknown>
  const order = (orderNo ?? String(row.order_number ?? row.order_no ?? "")).trim()
  let customer = customerId ?? (row.customer_id as string | null) ?? null
  if (!customer && order) {
    const { data: entry } = await admin.from("sale_list_entries").select("customer_id").eq("order_number", order).maybeSingle()
    customer = (entry?.customer_id as string | null) ?? null
    if (!customer) {
      const { data: byOrder } = await admin.from("customers").select("id").eq("order_number", order).maybeSingle()
      customer = (byOrder?.id as string | null) ?? null
    }
  }
  let address = String(row.address ?? "").trim()
  if (!address && customer) {
    const { data: c } = await admin.from("customers").select("address").eq("id", customer).maybeSingle()
    address = String(c?.address ?? "").trim()
  }
  const repair = entityType === "repair_plans"
  return {
    key: `${entityType}:${entityId}`,
    table: entityType,
    recordId: entityId,
    jobType: jobType as ScheduleJobType,
    date,
    orderNo: order,
    customerId: customer ?? undefined,
    name: String(row.member_account || row.name || row.account_name || order),
    address: address || undefined,
    technician: String((repair ? row.th : row.serviceman) ?? ""),
    technician2: String((repair ? row.th_2 : row.serviceman_2) ?? ""),
  }
}
