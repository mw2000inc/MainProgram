import "server-only"
import { addDays, format, parseISO } from "date-fns"
import { createAdminClient } from "@/lib/supabase/admin"
import { createDispatchAssigner } from "@/lib/scheduling/dispatch-assignment"
import { dispatchDateFor } from "@/lib/schedule-timeframe"
import { assignmentAccounts, technicianAccountIds } from "@/lib/technicians"
import type { UnscheduledVisit, VisitTable } from "@/lib/scheduling/unscheduled-visits"
import type { ScheduleJobStatus, ScheduleJobType } from "@/lib/types"
import type { AutomationResult } from "../types"

// Draft window: visits from a few days back (Friday's still-open visits on a
// Monday) through a week ahead.
const LOOKBACK_DAYS = 3
const LOOKAHEAD_DAYS = 7

// Pre-schedules the Daily Report's upcoming visits as DRAFT jobs for an admin
// to review. For every dispatch-confirmed, still-pending Filter Change /
// Installation / Repair / Collection visit in the window that no job covers:
//   - a job is created as 'pending_approval' with source 'automation' — a
//     draft: admins see it in the Schedule with a "Draft · Auto-assigned"
//     badge and approve it ("Approve & Dispatch All Drafts"); technicians
//     can't see it until then (schedule_jobs RLS hides pending_approval);
//   - technician, vehicle and the technicians' logins come from
//     createDispatchAssigner (planned technician → customer's technician →
//     least-busy field technician that day);
//   - it's dated the visit's own date (a Friday visit on Saturday), or today
//     for one already past;
//   - the visit is linked to it straight away, so it leaves Unscheduled
//     Visits and is never drafted twice.
// A visit whose order already has an open job of the same type is skipped.
export async function runGenerateDraftJobs(): Promise<AutomationResult> {
  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const start = format(addDays(parseISO(today), -LOOKBACK_DAYS), "yyyy-MM-dd")
  const end = format(addDays(parseISO(today), LOOKAHEAD_DAYS), "yyyy-MM-dd")

  const [customersRes, accountsRes, jobsRes] = await Promise.all([
    admin.from("customers").select("id, order_number, address, full_name, company_name, assigned_technician, assigned_technician_2"),
    admin.from("profiles").select("id, name, role"),
    admin
      .from("schedule_jobs")
      .select("job_type, order_no, technician, technician_2, scheduled_date, status, vehicle, created_at")
      .gte("scheduled_date", format(addDays(parseISO(start), -30), "yyyy-MM-dd")),
  ])
  for (const r of [customersRes, accountsRes, jobsRes]) if (r.error) return { ok: false, message: r.error.message }
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
    { table: "install_plans", jobType: "installation", pre: "pre_installed_date", base: "input_date", done: "installed_date", order: "order_no" },
    { table: "repair_plans", jobType: "repair", pre: "pre_d", base: "issued_date", done: "acc_d", order: "order_no" },
    { table: "collections", jobType: "collection", pre: "pre_d", base: "collection_date", done: "acc_d", order: "order_no" },
  ]
  for (const src of sources) {
    const { data, error } = await admin
      .from(src.table)
      .select("*")
      .eq("status", "Pending")
      .is("schedule_job_id", null)
      .is(src.done, null)
      .or("dispatch_status.is.null,dispatch_status.eq.Confirmed")
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
    })),
    customers: customers.map((c) => ({ id: c.id as string, assignedTechnician: c.assigned_technician ?? "", assignedTechnician2: c.assigned_technician_2 ?? undefined })),
    accounts,
  })

  let drafted = 0
  let skippedOpenJob = 0
  const bySource: Record<string, number> = {}
  const errors: string[] = []
  for (const visit of visits.sort((a, b) => a.date.localeCompare(b.date))) {
    const dedupeKey = `${visit.jobType}|${visit.orderNo}`
    if (visit.orderNo && openJob.has(dedupeKey)) {
      skippedOpenJob++
      continue
    }
    const own = dispatchDateFor(visit.date)
    const date = own < today ? today : own
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
    message: `Drafted ${drafted} job(s) from ${visits.length} unscheduled visit(s) (${start} to ${end}); ${skippedOpenJob} skipped (order already has an open job); ${errors.length} error(s).`,
    detail: { window: { start, end }, visits: visits.length, drafted, skippedOpenJob, bySource, errors },
  }
}
