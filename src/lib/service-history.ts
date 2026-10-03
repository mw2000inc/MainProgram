import { addDays, isBefore, parseISO } from "date-fns"
import type { CollectionPlan, Customer, FilterChangePlan, InstallPlan, RepairPlan } from "@/lib/types"

export interface ServiceVisit {
  date: string
  type: string
  technician: string
  notes: string
}

const VISIT_TYPES = [
  "Installation & Setup",
  "Routine Maintenance",
  "Filter Replacement",
  "Water Quality Check",
  "Repair Visit",
]

type ServiceHistoryCustomer = Pick<Customer, "contractStart" | "contractEnd" | "assignedTechnician" | "dispenserType">

// Deterministic, derived service schedule (every ~90 days since contract start) — not a persisted entity.
export function getServiceHistory(customer: ServiceHistoryCustomer, now: Date = new Date()): ServiceVisit[] {
  const start = parseISO(customer.contractStart)
  const end = isBefore(now, parseISO(customer.contractEnd)) ? now : parseISO(customer.contractEnd)
  const visits: ServiceVisit[] = []
  let cursor = start
  let i = 0
  while (!isBefore(end, cursor)) {
    visits.push({
      date: cursor.toISOString().slice(0, 10),
      type: i === 0 ? "Installation & Setup" : VISIT_TYPES[i % VISIT_TYPES.length],
      technician: customer.assignedTechnician,
      notes: i === 0 ? `${customer.dispenserType} unit installed.` : "Standard service completed, no issues reported.",
    })
    cursor = addDays(cursor, 90)
    i++
  }
  return visits.reverse()
}

// ---------------------------------------------------------------------------
// The member page's real Service History: the customer's actual Installation,
// Filter Change, Repair and Collection records (matched by customer id or by
// any of the customer's order numbers), dated on or before today, newest
// first. Future recurring visits (the schedule runs years ahead) are left
// out — this is history, not the plan.
// ---------------------------------------------------------------------------
export type ServiceEventKind = "installation" | "filter_change" | "repair" | "collection"

export interface ServiceEvent {
  key: string
  kind: ServiceEventKind
  recordId: string
  // Completion date when there is one, otherwise the planned date.
  date: string
  completed: boolean
  status: string
  orderNo: string
  technician: string
  technician2?: string
  // Kind-specific lines, as [label key, value] for the page to translate.
  details: [string, string][]
  href: string
}

type Line = [string, string | number | undefined | null]
const lines = (...entries: Line[]): [string, string][] =>
  entries.filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== null && String(e[1]).trim() !== "").map(([k, v]) => [k, String(v)])

export function buildServiceTimeline(
  customer: Pick<Customer, "id" | "orderNumber">,
  orderNumbers: Iterable<string>,
  data: {
    filterChangePlans: FilterChangePlan[]
    installPlans: InstallPlan[]
    repairPlans: RepairPlan[]
    collections: CollectionPlan[]
  },
  today: string
): ServiceEvent[] {
  const orders = new Set([customer.orderNumber, ...orderNumbers].map((o) => o?.trim()).filter(Boolean))
  const mine = (orderNo: string | undefined, customerId?: string) => customerId === customer.id || orders.has(orderNo?.trim() ?? "")
  const events: ServiceEvent[] = []
  const push = (e: ServiceEvent) => {
    if (e.date && e.date <= today) events.push(e)
  }

  for (const p of data.installPlans) {
    if (!mine(p.orderNo)) continue
    push({
      key: `in:${p.id}`, kind: "installation", recordId: p.id, orderNo: p.orderNo, status: p.status,
      date: p.installedDate || p.preInstalledDate || p.inputDate, completed: !!p.installedDate,
      technician: p.serviceman, technician2: p.serviceman2,
      details: lines(["serviceModel", p.model], ["serviceNote", p.note]),
      href: `/install?id=${p.id}`,
    })
  }
  for (const p of data.filterChangePlans) {
    if (!mine(p.orderNumber, p.customerId)) continue
    push({
      key: `fc:${p.id}`, kind: "filter_change", recordId: p.id, orderNo: p.orderNumber, status: p.status,
      date: p.accD || p.preD || p.planDate, completed: !!p.accD || p.status === "Completed",
      technician: p.serviceman, technician2: p.serviceman2,
      details: lines(["serviceFilters", p.filterType], ["serviceNote", p.note]),
      href: `/filter-change?id=${p.id}`,
    })
  }
  for (const p of data.repairPlans) {
    if (!mine(p.orderNo)) continue
    push({
      key: `re:${p.id}`, kind: "repair", recordId: p.id, orderNo: p.orderNo, status: p.status,
      date: p.accD || p.preD || p.issuedDate, completed: !!p.accD || p.status === "Completed",
      technician: p.th, technician2: p.th2,
      details: lines(["serviceIssue", p.problem], ["serviceSolution", p.solutionStatus], ["serviceParts", p.partNo], ["serviceNote", p.note]),
      href: `/repair-plan?id=${p.id}`,
    })
  }
  for (const p of data.collections) {
    if (!mine(p.orderNo, p.customerId)) continue
    push({
      key: `co:${p.id}`, kind: "collection", recordId: p.id, orderNo: p.orderNo, status: p.status,
      date: p.accD || p.preD || p.collectionDate, completed: !!p.collected || p.status === "Collected",
      technician: p.serviceman, technician2: p.serviceman2,
      details: lines(["serviceTerm", p.ct], ["serviceAmount", p.amount ? `₱${p.amount.toLocaleString()}` : undefined], ["serviceNote", p.note]),
      href: `/collection-plan?id=${p.id}`,
    })
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
}
