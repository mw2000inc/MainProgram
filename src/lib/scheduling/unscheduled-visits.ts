import type { CollectionPlan, Customer, FilterChangePlan, InstallPlan, RepairPlan, ScheduleJobType } from "@/lib/types"

export type VisitTable = "filter_change_plans" | "install_plans" | "repair_plans" | "collections"

// A Filter Change / Installation / Repair / Collection visit planned for a
// day in the Schedule's timeframe that no schedule job covers yet — the
// recurring generators (and each module's own Add form) create visits, but
// only a dispatch confirmation or an admin turns one into a job. Listed in
// the Schedule's "Unscheduled Visits" group so it can be scheduled.
export interface UnscheduledVisit {
  key: string
  table: VisitTable
  recordId: string
  jobType: ScheduleJobType
  date: string
  orderNo: string
  customerId?: string
  name: string
  address?: string
  technician: string
  technician2: string
  // What the visit is for, for the row and the new job's notes.
  detail?: string
  filterCodes?: string
}

// Only what the Daily Report itself would show for the day: still Pending,
// dispatch-confirmed (or from before dispatch statuses existed), and not
// linked to a job.
const isOpen = (r: { status: string; dispatchStatus?: string; scheduleJobId?: string }) =>
  r.status === "Pending" && (r.dispatchStatus === undefined || r.dispatchStatus === "Confirmed") && !r.scheduleJobId

export function buildUnscheduledVisits(
  data: {
    filterChangePlans: FilterChangePlan[]
    installPlans: InstallPlan[]
    repairPlans: RepairPlan[]
    collections: CollectionPlan[]
    customers: Customer[]
  },
  range: { start: string; end: string }
): UnscheduledVisit[] {
  const inRange = (d: string | undefined) => !!d && d >= range.start && d <= range.end
  const customerByOrder = new Map(data.customers.map((c) => [c.orderNumber?.trim(), c]))
  const customerName = (c: Customer | undefined) => (c ? c.companyName || c.fullName : undefined)
  const visits: UnscheduledVisit[] = []

  for (const p of data.filterChangePlans) {
    const date = p.preD || p.planDate
    if (!isOpen(p) || !inRange(date) || p.accD) continue
    const customer = customerByOrder.get(p.orderNumber?.trim())
    visits.push({
      key: `fc:${p.id}`,
      table: "filter_change_plans",
      recordId: p.id,
      jobType: "filter_change",
      date,
      orderNo: p.orderNumber,
      customerId: p.customerId ?? customer?.id,
      name: p.memberAccount || customerName(customer) || p.orderNumber,
      address: p.address || customer?.address,
      technician: p.serviceman,
      technician2: p.serviceman2 ?? "",
      detail: p.filterType || undefined,
      filterCodes: p.filterType || undefined,
    })
  }
  for (const p of data.installPlans) {
    const date = p.preInstalledDate || p.inputDate
    if (!isOpen(p) || !inRange(date) || p.installedDate) continue
    const customer = customerByOrder.get(p.orderNo?.trim())
    visits.push({
      key: `in:${p.id}`,
      table: "install_plans",
      recordId: p.id,
      jobType: "installation",
      date,
      orderNo: p.orderNo,
      customerId: customer?.id,
      name: p.name || customerName(customer) || p.orderNo,
      address: p.address || customer?.address,
      technician: p.serviceman,
      technician2: p.serviceman2 ?? "",
      detail: p.model || undefined,
    })
  }
  for (const p of data.repairPlans) {
    const date = p.preD || p.issuedDate
    if (!isOpen(p) || !inRange(date) || p.accD) continue
    const customer = customerByOrder.get(p.orderNo?.trim())
    visits.push({
      key: `re:${p.id}`,
      table: "repair_plans",
      recordId: p.id,
      jobType: "repair",
      date,
      orderNo: p.orderNo,
      customerId: customer?.id,
      name: p.accountName || customerName(customer) || p.orderNo,
      address: p.address || customer?.address,
      technician: p.th,
      technician2: p.th2 ?? "",
      detail: p.problem || undefined,
    })
  }
  for (const p of data.collections) {
    const date = p.preD || p.collectionDate
    if (!isOpen(p) || !inRange(date) || p.collected) continue
    const customer = (p.customerId && data.customers.find((c) => c.id === p.customerId)) || customerByOrder.get(p.orderNo?.trim())
    visits.push({
      key: `co:${p.id}`,
      table: "collections",
      recordId: p.id,
      jobType: "collection",
      date,
      orderNo: p.orderNo,
      customerId: p.customerId ?? customer?.id,
      name: p.accountName || customerName(customer) || p.orderNo,
      address: customer?.address,
      technician: p.serviceman,
      technician2: p.serviceman2 ?? "",
      detail: [p.ct, p.amount ? `₱${p.amount.toLocaleString()}` : ""].filter(Boolean).join(" · ") || undefined,
    })
  }
  return visits.sort((a, b) => a.date.localeCompare(b.date) || a.jobType.localeCompare(b.jobType) || a.name.localeCompare(b.name))
}
