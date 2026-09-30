import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from "date-fns"
import { isAssignedTechnician } from "@/lib/technicians"
import type { CollectionPlan, Customer, FilterChangePlan, InstallPlan, RepairPlan, ScheduleJob, ScheduleJobType } from "@/lib/types"

// Per-technician workload: how many jobs each technician has been assigned,
// and completed, this week and this month — shown on the Schedule toolbar
// and in the Auto-suggest modal, with the jobs behind each count listed in
// the Technician Activity History dialog.
//
// Counted from the Filter Change / Collection / Repair / Install records
// rather than schedule_jobs alone — those are where a technician is actually
// recorded (serviceman / th). Checked live: schedule_jobs held 27 rows, all
// pending and all but one unassigned, while September's Filter Change
// visits alone had 105 with a serviceman. A schedule job is added only when
// no record links to it (errands, manual jobs), so nothing counts twice.
//
// "Completed": the record's status says so, or its done-date is set (Acc D,
// collected, installed) — checked live, status is rarely updated
// (1 Completed of 2,697 Filter Change visits) while Repair's Acc D is set on
// 345 of 350. Cancelled/rejected records are left out entirely.

export interface WorkloadCounts {
  weekAssigned: number
  weekCompleted: number
  monthAssigned: number
  monthCompleted: number
}

export type WorkloadSource = "filter_change" | "collection" | "repair" | "installation" | "schedule_job"

// One job behind the counts, with what the history dialog shows for it.
export interface WorkloadRecord {
  key: string
  source: WorkloadSource
  // For a schedule job, its own type ("other" is a custom errand).
  jobType: ScheduleJobType
  date: string
  status: string
  completed: boolean
  completedDate?: string
  technician: string
  technician2?: string
  customerName: string
  orderNo: string
  address: string
  filterCodes: string
  notes: string
  // Lower-cased names, for filtering by technician.
  technicianKeys: string[]
}

export type WorkloadPeriod = "week" | "month"

const DONE = /^(completed|done)$/i
const CANCELLED = /cancel|reject/i
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()
const joinText = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ")

// The whole team's totals, under a key no technician name can produce —
// each record counted once, even when two technicians share it (adding
// up every technician's own counts would count those twice).
export const ALL_TECHNICIANS = "\u0000all"

export function buildWorkloadRecords(sources: {
  filterChangePlans: FilterChangePlan[]
  collections: CollectionPlan[]
  repairPlans: RepairPlan[]
  installPlans: InstallPlan[]
  scheduleJobs: ScheduleJob[]
  customers?: Customer[]
}): WorkloadRecord[] {
  const customerById = new Map((sources.customers ?? []).map((c) => [c.id, c]))
  const customerName = (id?: string) => {
    const c = id ? customerById.get(id) : undefined
    return c ? c.companyName || c.fullName || "" : ""
  }
  const records: WorkloadRecord[] = []
  const linkedJobIds = new Set<string>()
  type RecordInput = Omit<WorkloadRecord, "technicianKeys" | "technician" | "technician2" | "completed"> & {
    technicians: (string | undefined)[]
    doneFlag: boolean
    scheduleJobId?: string
  }
  const add = ({ technicians, doneFlag, scheduleJobId, ...r }: RecordInput) => {
    if (scheduleJobId) linkedJobIds.add(scheduleJobId)
    if (!r.date || CANCELLED.test(r.status)) return
    const names = technicians.filter((t): t is string => isAssignedTechnician(t)).map((t) => t.trim())
    if (names.length === 0) return
    records.push({
      ...r,
      date: r.date.slice(0, 10),
      completed: doneFlag || DONE.test(r.status),
      technician: names[0],
      technician2: names[1],
      technicianKeys: [...new Set(names.map(nameKey))],
    })
  }

  for (const p of sources.filterChangePlans) {
    add({
      key: `fc-${p.id}`, source: "filter_change", jobType: "filter_change", date: p.preD || p.planDate, status: p.status,
      doneFlag: !!p.accD, completedDate: p.accD, technicians: [p.serviceman, p.serviceman2], scheduleJobId: p.scheduleJobId,
      customerName: p.memberAccount || customerName(p.customerId), orderNo: p.orderNumber, address: p.address,
      filterCodes: p.filterType, notes: p.note ?? "",
    })
  }
  for (const p of sources.collections) {
    add({
      key: `col-${p.id}`, source: "collection", jobType: "collection", date: p.preD || p.collectionDate, status: p.status,
      doneFlag: !!p.collected, completedDate: p.collectedAt?.slice(0, 10), technicians: [p.serviceman, p.serviceman2],
      scheduleJobId: p.scheduleJobId, customerName: p.accountName || customerName(p.customerId), orderNo: p.orderNo,
      address: (p.customerId && customerById.get(p.customerId)?.address) || "", filterCodes: "",
      notes: joinText(p.amount ? `Amount ${p.amount}` : "", p.note),
    })
  }
  for (const p of sources.repairPlans) {
    add({
      key: `rep-${p.id}`, source: "repair", jobType: "repair", date: p.preD || p.issuedDate, status: p.status,
      doneFlag: !!p.accD, completedDate: p.accD, technicians: [p.th, p.th2], scheduleJobId: p.scheduleJobId,
      customerName: p.accountName, orderNo: p.orderNo, address: p.address ?? "", filterCodes: "",
      notes: joinText(p.problem ? `Problem: ${p.problem}` : "", p.solutionStatus, p.note),
    })
  }
  for (const p of sources.installPlans) {
    add({
      key: `ins-${p.id}`, source: "installation", jobType: "installation", date: p.preInstalledDate || p.inputDate, status: p.status,
      doneFlag: !!p.installedDate, completedDate: p.installedDate, technicians: [p.serviceman, p.serviceman2],
      scheduleJobId: p.scheduleJobId, customerName: p.name, orderNo: p.orderNo, address: p.address ?? "", filterCodes: "",
      notes: joinText(p.model, p.note),
    })
  }
  for (const j of sources.scheduleJobs) {
    if (linkedJobIds.has(j.id)) continue
    const customer = j.customerId ? customerById.get(j.customerId) : undefined
    add({
      key: `job-${j.id}`, source: "schedule_job", jobType: j.jobType, date: j.scheduledDate, status: j.status,
      doneFlag: j.status === "completed", technicians: [j.technician, j.technician2], customerName: customerName(j.customerId),
      orderNo: j.orderNo ?? "", address: j.secondaryAddress || customer?.address || "", filterCodes: j.filterCodes ?? "",
      notes: j.notes ?? "",
    })
  }
  return records
}

export function workloadWindows(today: Date = new Date()): Record<WorkloadPeriod, [string, string]> {
  return {
    week: [format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"), format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")],
    month: [format(startOfMonth(today), "yyyy-MM-dd"), format(endOfMonth(today), "yyyy-MM-dd")],
  }
}

// The records behind one count — the same filter the counts use, so the
// list's length always equals the number on the badge. name may be
// ALL_TECHNICIANS.
export function workloadRecordsFor(records: WorkloadRecord[], name: string, period: WorkloadPeriod, today: Date = new Date()): WorkloadRecord[] {
  const [from, to] = workloadWindows(today)[period]
  const key = name === ALL_TECHNICIANS ? undefined : nameKey(name)
  return records
    .filter((r) => r.date >= from && r.date <= to && (!key || r.technicianKeys.includes(key)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.technician.localeCompare(b.technician))
}

export function buildWorkloadIndex(records: WorkloadRecord[], today: Date = new Date()): Map<string, WorkloadCounts> {
  const { week, month } = workloadWindows(today)
  const index = new Map<string, WorkloadCounts>()
  for (const r of records) {
    const inWeek = r.date >= week[0] && r.date <= week[1]
    const inMonth = r.date >= month[0] && r.date <= month[1]
    if (!inWeek && !inMonth) continue
    for (const name of [ALL_TECHNICIANS, ...r.technicianKeys]) {
      const c = index.get(name) ?? { weekAssigned: 0, weekCompleted: 0, monthAssigned: 0, monthCompleted: 0 }
      if (inWeek) {
        c.weekAssigned += 1
        if (r.completed) c.weekCompleted += 1
      }
      if (inMonth) {
        c.monthAssigned += 1
        if (r.completed) c.monthCompleted += 1
      }
      index.set(name, c)
    }
  }
  return index
}

// name may be ALL_TECHNICIANS for the team total.
export function workloadFor(index: Map<string, WorkloadCounts>, name: string): WorkloadCounts {
  const key = name === ALL_TECHNICIANS ? name : nameKey(name)
  return index.get(key) ?? { weekAssigned: 0, weekCompleted: 0, monthAssigned: 0, monthCompleted: 0 }
}

// For labels/tooltips: "Mon 28 Sep – Sun 4 Oct" and "September 2026".
export function workloadPeriodLabels(today: Date = new Date()): { week: string; month: string } {
  return {
    week: `${format(startOfWeek(today, { weekStartsOn: 1 }), "EEE d MMM")} – ${format(endOfWeek(today, { weekStartsOn: 1 }), "EEE d MMM")}`,
    month: format(today, "MMMM yyyy"),
  }
}
