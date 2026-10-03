import type { CollectionPlan, Customer, FilterChangePlan, InstallPlan, RepairPlan } from "@/lib/types"

// ---------------------------------------------------------------------------
// Service History (the member page and the public QR-scan portal): the
// customer's real Installation, Filter Change, Repair and Collection records
// (matched by customer id or by any of the customer's order numbers), dated on
// or before today, newest first. Future recurring visits (the schedule runs
// years ahead) are left out — this is history, not the plan.
//
// This replaced a generated placeholder history (a made-up visit every 90
// days with canned notes) that read no records at all.
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
  // The record's own page — omitted for the public portal.
  href?: string
}

// Only the fields the timeline reads, so the portal's slimmer records fit too.
type TimelineInstall = Pick<InstallPlan, "id" | "orderNo" | "status" | "inputDate" | "serviceman"> &
  Partial<Pick<InstallPlan, "preInstalledDate" | "installedDate" | "serviceman2" | "model" | "note">>
type TimelineFilterChange = Pick<FilterChangePlan, "id" | "orderNumber" | "status" | "planDate" | "serviceman"> &
  Partial<Pick<FilterChangePlan, "customerId" | "preD" | "accD" | "serviceman2" | "filterType" | "note">>
type TimelineRepair = Pick<RepairPlan, "id" | "orderNo" | "status" | "issuedDate" | "th"> &
  Partial<Pick<RepairPlan, "preD" | "accD" | "th2" | "problem" | "solutionStatus" | "partNo" | "note">>
type TimelineCollection = Pick<CollectionPlan, "id" | "orderNo" | "status" | "collectionDate"> &
  Partial<Pick<CollectionPlan, "customerId" | "preD" | "accD" | "collected" | "serviceman" | "serviceman2" | "ct" | "amount" | "note">>

type Line = [string, string | number | undefined | null]
const lines = (...entries: Line[]): [string, string][] =>
  entries.filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== null && String(e[1]).trim() !== "").map(([k, v]) => [k, String(v)])

export function buildServiceTimeline(
  customer: Pick<Customer, "id" | "orderNumber">,
  orderNumbers: Iterable<string>,
  data: {
    filterChangePlans: TimelineFilterChange[]
    installPlans: TimelineInstall[]
    repairPlans: TimelineRepair[]
    collections: TimelineCollection[]
  },
  today: string,
  // The public portal leaves out internal notes and links to admin pages.
  options: { publicView?: boolean } = {}
): ServiceEvent[] {
  const { publicView = false } = options
  const orders = new Set([customer.orderNumber, ...orderNumbers].map((o) => o?.trim()).filter(Boolean))
  const mine = (orderNo: string | undefined, customerId?: string) => customerId === customer.id || orders.has(orderNo?.trim() ?? "")
  const note = (value: string | undefined): Line => ["serviceNote", publicView ? undefined : value]
  const link = (href: string) => (publicView ? undefined : href)
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
      details: lines(["serviceModel", p.model], note(p.note)),
      href: link(`/install?id=${p.id}`),
    })
  }
  for (const p of data.filterChangePlans) {
    if (!mine(p.orderNumber, p.customerId)) continue
    push({
      key: `fc:${p.id}`, kind: "filter_change", recordId: p.id, orderNo: p.orderNumber, status: p.status,
      date: p.accD || p.preD || p.planDate, completed: !!p.accD || p.status === "Completed",
      technician: p.serviceman, technician2: p.serviceman2,
      details: lines(["serviceFilters", p.filterType], note(p.note)),
      href: link(`/filter-change?id=${p.id}`),
    })
  }
  for (const p of data.repairPlans) {
    if (!mine(p.orderNo)) continue
    push({
      key: `re:${p.id}`, kind: "repair", recordId: p.id, orderNo: p.orderNo, status: p.status,
      date: p.accD || p.preD || p.issuedDate, completed: !!p.accD || p.status === "Completed",
      technician: p.th, technician2: p.th2,
      details: lines(["serviceIssue", p.problem], ["serviceSolution", p.solutionStatus], ["serviceParts", p.partNo], note(p.note)),
      href: link(`/repair-plan?id=${p.id}`),
    })
  }
  for (const p of data.collections) {
    if (!mine(p.orderNo, p.customerId)) continue
    push({
      key: `co:${p.id}`, kind: "collection", recordId: p.id, orderNo: p.orderNo, status: p.status,
      date: p.accD || p.preD || p.collectionDate, completed: !!p.collected || p.status === "Collected",
      technician: p.serviceman ?? "", technician2: p.serviceman2,
      details: lines(["serviceTerm", p.ct], ["serviceAmount", p.amount ? `₱${p.amount.toLocaleString()}` : undefined], note(p.note)),
      href: link(`/collection-plan?id=${p.id}`),
    })
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind))
}
