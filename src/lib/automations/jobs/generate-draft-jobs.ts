import "server-only"
import { addDays, format, parseISO } from "date-fns"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDispatchAssigner, previousTechniciansByOrder } from "@/lib/scheduling/dispatch-assignment"
import { autoJobDate } from "@/lib/schedule-timeframe"
import { businessToday } from "@/lib/dispatch-lead-time"
import { assignmentAccounts, technicianAccountIds } from "@/lib/technicians"
import type { UnscheduledVisit, VisitTable } from "@/lib/scheduling/unscheduled-visits"
import type { ScheduleJobStatus, ScheduleJobType } from "@/lib/types"
import type { AutomationContext, AutomationResult } from "../types"

// Draft window: visits from a few days back (on a Monday, Friday's still-open
// visits and the weekend's) through a month ahead — the admin approves a
// month of Filter Changes and Collections in advance.
const LOOKBACK_DAYS = 3
const LOOKAHEAD_DAYS = 30
// Visits dated before this day are never drafted automatically (admin,
// 2026-10-14: October 2026's automatic drafts were cleared and October is
// scheduled by hand). Visits from this day on are drafted as usual.
export const AUTO_DRAFT_FROM = "2026-11-01"

// Pre-schedules the Daily Report's upcoming visits as DRAFT jobs for an admin
// to review. For every still-pending (confirmed or not yet confirmed) Filter Change or
// Collection visit in the window that no job covers (Installations and
// Repairs are scheduled by hand — Schedule Job — as requests come in):
//   - a job is created as 'pending_approval' with source 'automation' — a
//     draft: admins see it in the Schedule with a "Draft · Auto-assigned"
//     badge and approve it ("Approve & Dispatch All Drafts"); technicians
//     can't see it until then (schedule_jobs RLS hides pending_approval);
//   - technician, vehicle and the technicians' logins come from
//     createDispatchAssigner (planned technician → same place that day →
//     customer's technician → whoever last serviced the order → nearby →
//     least-busy field technician that day; a crew member always brings the
//     whole crew). The record gets the same Serviceman the moment it's linked
//     (20261104000000);
//   - it's dated Monday to Friday only (autoJobDate): the visit's own date,
//     or today for one already past — a Saturday or Sunday becomes the
//     following Monday (Manila calendar). Saturday work is assigned by hand;
//   - the visit is linked to it straight away, so it leaves Unscheduled
//     Visits and is never drafted twice.
// A visit whose order already has an open job of the same type is skipped.
//
// With ctx.date (a one-day run), only drafts whose job lands on that date are
// made: visits dated that day, the weekend's visits for a Monday, and — when
// that day is today — the open visits of the last few days that roll onto
// today. The scheduled run keeps the full window above.
// Drafts whose day has passed without approval are stale: every unapproved
// ('pending_approval') job dated before today is deleted — any source. Its
// linked Filter Change / Collection / Install / Repair record is untouched
// apart from losing the link (schedule_job_id on delete set null), so the
// record shows in Unscheduled Visits again and the run below can draft it
// anew (a past visit is drafted for today). Approved, completed and
// cancelled jobs are never touched; nor is a draft with stock movements or
// recorded filters (a draft can't have either — belt and braces). Run by the
// 6 AM cron (api/cron/send-schedule-reminders).
export async function purgePastDrafts(admin: ReturnType<typeof createAdminClient>, today: string): Promise<{ purged: number; error?: string }> {
  const { data: stale, error } = await admin.from("schedule_jobs").select("id").eq("status", "pending_approval").lt("scheduled_date", today)
  if (error) return { purged: 0, error: error.message }
  const ids = (stale ?? []).map((j) => j.id as string)
  if (ids.length === 0) return { purged: 0 }
  const [{ data: moved }, { data: items }] = await Promise.all([
    admin.from("stock_movements").select("schedule_job_id").in("schedule_job_id", ids),
    admin.from("schedule_job_filter_items").select("schedule_job_id").in("schedule_job_id", ids),
  ])
  const keep = new Set([...(moved ?? []), ...(items ?? [])].map((r) => r.schedule_job_id as string))
  const remove = ids.filter((id) => !keep.has(id))
  if (remove.length === 0) return { purged: 0 }
  const { data: deleted, error: deleteError } = await admin
    .from("schedule_jobs")
    .delete()
    .in("id", remove)
    .eq("status", "pending_approval")
    .lt("scheduled_date", today)
    .select("id")
  return { purged: deleted?.length ?? 0, error: deleteError?.message }
}

export async function runGenerateDraftJobs(ctx?: AutomationContext): Promise<AutomationResult> {
  const admin = createAdminClient()
  // The Manila business day — not the server's UTC date, which is still
  // yesterday before 08:00 Manila.
  const today = businessToday()
  const onlyDate = ctx?.date
  // Three days back either way: covers the weekend before a Monday.
  const start = format(addDays(parseISO(onlyDate ?? today), -LOOKBACK_DAYS), "yyyy-MM-dd")
  const end = onlyDate ?? format(addDays(parseISO(today), LOOKAHEAD_DAYS), "yyyy-MM-dd")

  const [customersRes, accountsRes, jobsRes] = await Promise.all([
    admin.from("customers").select("id, order_number, address, full_name, company_name, member_account_number, latitude, longitude, assigned_technician, assigned_technician_2"),
    admin.from("profiles").select("id, name, role"),
    admin
      .from("schedule_jobs")
      .select("job_type, order_no, customer_id, secondary_address, latitude, longitude, technician, technician_2, scheduled_date, status, vehicle, created_at")
      .gte("scheduled_date", format(addDays(parseISO(start), -30), "yyyy-MM-dd")),
  ])
  for (const r of [customersRes, accountsRes, jobsRes]) if (r.error) return { ok: false, message: r.error.message }

  // Who last serviced each order: completed jobs, and done records (their
  // Serviceman / TH) — the latest 1,000 of each is plenty.
  const history = await Promise.all([
    admin.from("schedule_jobs").select("order_no, technician, technician_2, scheduled_date").eq("status", "completed").order("scheduled_date", { ascending: false }).limit(1000),
    admin.from("filter_change_plans").select("order_number, serviceman, serviceman_2, acc_d").not("acc_d", "is", null).order("acc_d", { ascending: false }).limit(1000),
    admin.from("collections").select("order_no, serviceman, serviceman_2, acc_d").not("acc_d", "is", null).order("acc_d", { ascending: false }).limit(1000),
    admin.from("install_plans").select("order_no, serviceman, serviceman_2, installed_date").not("installed_date", "is", null).order("installed_date", { ascending: false }).limit(1000),
    admin.from("repair_plans").select("order_no, th, th_2, acc_d").not("acc_d", "is", null).order("acc_d", { ascending: false }).limit(1000),
  ])
  const [doneJobs, doneFc, doneCol, doneInst, doneRep] = history.map((r) => (r.data ?? []) as Record<string, string | null>[])
  const previous = previousTechniciansByOrder([
    ...doneJobs.map((r) => ({ orderNo: r.order_no, technician: r.technician, technician2: r.technician_2, date: r.scheduled_date })),
    ...doneFc.map((r) => ({ orderNo: r.order_number, technician: r.serviceman, technician2: r.serviceman_2, date: r.acc_d })),
    ...doneCol.map((r) => ({ orderNo: r.order_no, technician: r.serviceman, technician2: r.serviceman_2, date: r.acc_d })),
    ...doneInst.map((r) => ({ orderNo: r.order_no, technician: r.serviceman, technician2: r.serviceman_2, date: r.installed_date })),
    ...doneRep.map((r) => ({ orderNo: r.order_no, technician: r.th, technician2: r.th_2, date: r.acc_d })),
  ])
  const customers = customersRes.data ?? []
  const accounts = assignmentAccounts((accountsRes.data ?? []).map((a) => ({ id: a.id as string, name: (a.name as string) ?? "", role: a.role as string })))
  const jobs = jobsRes.data ?? []

  const customerById = new Map(customers.map((c) => [c.id as string, c]))
  const customerByOrder = new Map(customers.filter((c) => c.order_number).map((c) => [String(c.order_number).trim(), c]))
  const nameOf = (c: (typeof customers)[number] | undefined) => (c ? c.company_name || c.full_name : undefined)

  // Orders that already have an open job of a type — never drafted again.
  const openJob = new Set(
    jobs.filter((j) => j.status === "pending" || j.status === "pending_approval").map((j) => `${j.job_type}|${String(j.order_no ?? "").trim()}`)
  )

  // The visits, per table: [table, job type, date column, base date column, extra filters].
  const visits: UnscheduledVisit[] = []
  const inWindow = (pre: string, base: string) => `and(${pre}.gte.${start},${pre}.lte.${end}),and(${pre}.is.null,${base}.gte.${start},${base}.lte.${end})`
  const sources: { table: VisitTable; jobType: ScheduleJobType; pre: string; base: string; done: string; order: string }[] = [
    { table: "filter_change_plans", jobType: "filter_change", pre: "pre_d", base: "plan_date", done: "acc_d", order: "order_number" },
    { table: "collections", jobType: "collection", pre: "pre_d", base: "collection_date", done: "acc_d", order: "order_no" },
  ]
  for (const src of sources) {
    const { data, error } = await admin
      .from(src.table)
      .select("*")
      .eq("status", "Pending")
      .is("schedule_job_id", null)
      .is(src.done, null)
      // Approval first: confirmed AND not-yet-confirmed ("Draft") records are
      // drafted — the admin's approval is the gate (and confirms the record,
      // 20261026). Records already with the customer (Pending Customer
      // Confirmation), with a reschedule request, or rejected are left out.
      .or("dispatch_status.is.null,dispatch_status.in.(Confirmed,Draft)")
      .or(inWindow(src.pre, src.base))
    if (error) return { ok: false, message: `${src.table}: ${error.message}` }
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      if (src.table === "collections" && r.collected) continue
      const orderNo = String(r[src.order] ?? "").trim()
      const customer = (r.customer_id ? customerById.get(r.customer_id as string) : undefined) ?? customerByOrder.get(orderNo)
      const technician = String((src.table === "repair_plans" ? r.th : r.serviceman) ?? "")
      const technician2 = String((src.table === "repair_plans" ? r.th_2 : r.serviceman_2) ?? "")
      visits.push({
        key: `${src.table}:${r.id}`,
        table: src.table,
        recordId: r.id as string,
        jobType: src.jobType,
        date: String(r[src.pre] ?? r[src.base]),
        orderNo,
        customerId: (r.customer_id as string | null) ?? customer?.id,
        name: String(r.member_account || r.name || r.account_name || nameOf(customer) || orderNo),
        address: String(r.address || customer?.address || "") || undefined,
        technician,
        technician2,
        detail:
          src.table === "collections"
            ? [r.c_t, Number(r.amount) ? `₱${Number(r.amount).toLocaleString()}` : ""].filter(Boolean).join(" · ") || undefined
            : String((src.table === "filter_change_plans" ? r.filter_type : src.table === "repair_plans" ? r.problem : r.model) ?? "") || undefined,
        filterCodes: src.table === "filter_change_plans" ? String(r.filter_type ?? "") || undefined : undefined,
      })
    }
  }

  const assigner = createDispatchAssigner({
    jobs: jobs.map((j) => ({
      technician: j.technician ?? "",
      technician2: j.technician_2 ?? undefined,
      scheduledDate: j.scheduled_date,
      status: j.status as ScheduleJobStatus,
      vehicle: j.vehicle ?? "",
      createdAt: j.created_at,
      customerId: j.customer_id ?? undefined,
      secondaryAddress: j.secondary_address ?? undefined,
      latitude: j.latitude ?? undefined,
      longitude: j.longitude ?? undefined,
    })),
    customers: customers.map((c) => ({
      id: c.id as string,
      assignedTechnician: c.assigned_technician ?? "",
      assignedTechnician2: c.assigned_technician_2 ?? undefined,
      memberAccountNumber: c.member_account_number ?? undefined,
      latitude: c.latitude ?? undefined,
      longitude: c.longitude ?? undefined,
    })),
    accounts,
    previous,
  })

  let drafted = 0
  let skippedOpenJob = 0
  const bySource: Record<string, number> = {}
  const errors: string[] = []
  let skippedBeforeStart = 0
  for (const visit of visits.sort((a, b) => a.date.localeCompare(b.date))) {
    if (visit.date < AUTO_DRAFT_FROM) {
      skippedBeforeStart++
      continue
    }
    const dedupeKey = `${visit.jobType}|${visit.orderNo}`
    if (visit.orderNo && openJob.has(dedupeKey)) {
      skippedOpenJob++
      continue
    }
    const date = autoJobDate(visit.date, today)
    // A one-day run makes only that day's drafts.
    if (onlyDate && date !== onlyDate) continue
    const assignment = assigner(visit, date)
    bySource[assignment.source] = (bySource[assignment.source] ?? 0) + 1
    const ids = technicianAccountIds(assignment.pair.primary, assignment.pair.secondary, accounts)
    const { data: job, error: insertError } = await admin
      .from("schedule_jobs")
      .insert({
        job_type: visit.jobType,
        status: "pending_approval",
        source: "automation",
        scheduled_date: date,
        order_no: visit.orderNo || null,
        customer_id: visit.customerId ?? null,
        technician: assignment.pair.primary,
        technician_2: assignment.pair.secondary || null,
        technician_user_id: ids.technicianUserId || null,
        technician_2_user_id: ids.technician2UserId || null,
        vehicle: assignment.vehicle,
        secondary_address: visit.address ?? null,
        notes: [visit.name, visit.detail].filter(Boolean).join(" — ") || null,
        filter_codes: visit.filterCodes ?? "",
      })
      .select("id")
      .single()
    if (insertError || !job) {
      errors.push(`${visit.orderNo}: ${insertError?.message ?? "no job returned"}`)
      continue
    }
    const { data: linked, error: linkError } = await admin
      .from(visit.table)
      .update({ schedule_job_id: job.id })
      .eq("id", visit.recordId)
      .is("schedule_job_id", null)
      .select("id")
    if (linkError || !linked?.length) {
      // Linked by someone else meanwhile — drop the draft rather than duplicate.
      await admin.from("schedule_jobs").delete().eq("id", job.id)
      if (linkError) errors.push(`${visit.orderNo}: ${linkError.message}`)
      continue
    }
    openJob.add(dedupeKey)
    drafted++
  }

  return {
    ok: errors.length === 0,
    message: `Drafted ${drafted} job(s) from ${visits.length} unscheduled visit(s) (${start} to ${end}); ${skippedOpenJob} skipped (order already has an open job); ${skippedBeforeStart} skipped (dated before ${AUTO_DRAFT_FROM}); ${errors.length} error(s).`,
    detail: { window: { start, end }, visits: visits.length, drafted, skippedOpenJob, skippedBeforeStart, bySource, errors },
  }
}
