"use client"

import * as React from "react"
import { History } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { computeStopNumbers, formatTechnicians } from "@/components/schedule/schedule-columns"
import { ApprovalDetailDialog } from "@/components/schedule/approval-detail-dialog"
import { PendingApprovalsHistoryDialog } from "@/components/schedule/pending-approvals-history-dialog"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import type { Customer, SaleListEntry, ScheduleJob } from "@/lib/types"
import type { DispatchEntityType } from "@/lib/api/dispatch-confirmation"

// The 4 job-type tabs (plus "all"), in the same fixed order used everywhere
// else in this file (Filter Change, Installation, Collection, Repair) — one
// small source of truth for both the TabsTrigger list and the Approval
// Summary cards below it, so the two can never list the types in a
// different order from each other.
const TYPE_TABS: { value: DispatchEntityType; moduleKey: PendingApprovalRow["moduleKey"]; tabLabelKey: string }[] = [
  { value: "filter_change_plans", moduleKey: "filterChangeModule", tabLabelKey: "filterChangeTabLabel" },
  { value: "install_plans", moduleKey: "installationModule", tabLabelKey: "installationTabLabel" },
  { value: "collections", moduleKey: "collectionModule", tabLabelKey: "collectionTabLabel" },
  { value: "repair_plans", moduleKey: "repairModule", tabLabelKey: "repairTabLabel" },
]

// One row per dispatch item genuinely awaiting admin attention — Draft
// (never yet approved) or Reschedule Requested (customer-declined-with-a-
// new-date, OR an admin's own request_reschedule_by_admin — both land on
// this same dispatch_status, see that migration's own comment on why no
// second status was invented for the admin-initiated case). Confirmed and
// Rejected rows never appear here — this is deliberately the same
// dispatch_status this app already tracks, just a second, more focused
// surface for it than DispatchApprovalQueue's own Dashboard panel (which
// stays completely unchanged — this doesn't replace it, admins can use
// either).
export interface PendingApprovalRow {
  entityType: DispatchEntityType
  entityId: string
  moduleKey: "filterChangeModule" | "installationModule" | "collectionModule" | "repairModule"
  recordLabel: string
  orderNumber?: string
  customerName?: string
  customerEmail?: string
  scheduledDate: string
  requestedTime?: string
  dispatchStatus: "Draft" | "Reschedule Requested"
  technician?: string
  technician2?: string
  routeSequence?: number
  notes?: string
  remarks?: string
  rescheduleReason?: string
  createdAt: string
}

function findCustomer(
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  { customerId, orderNumber }: { customerId?: string; orderNumber?: string }
): Customer | undefined {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId)
    if (byId) return byId
  }
  if (orderNumber) return findCustomerByOrderNumber(customers, saleListEntries, orderNumber)
  return undefined
}

function buildRows(
  filterChangePlans: ReturnType<typeof useFilterChangePlans>["data"],
  installPlans: ReturnType<typeof useInstallPlans>["data"],
  collections: ReturnType<typeof useCollections>["data"],
  repairPlans: ReturnType<typeof useRepairPlans>["data"],
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  scheduleJobs: ScheduleJob[]
): PendingApprovalRow[] {
  const rows: PendingApprovalRow[] = []
  const jobById = new Map(scheduleJobs.map((j) => [j.id, j]))

  function withJob(scheduleJobId: string | undefined, base: Omit<PendingApprovalRow, "technician" | "technician2" | "routeSequence" | "remarks">): PendingApprovalRow {
    const job = scheduleJobId ? jobById.get(scheduleJobId) : undefined
    return {
      ...base,
      technician: job?.technician,
      technician2: job?.technician2,
      routeSequence: job?.routeSequence,
      remarks: job?.remarks,
      notes: base.notes ?? job?.notes,
    }
  }

  for (const p of filterChangePlans ?? []) {
    if (p.dispatchStatus !== "Draft" && p.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { customerId: p.customerId, orderNumber: p.orderNumber })
    rows.push(
      withJob(p.scheduleJobId, {
        entityType: "filter_change_plans",
        entityId: p.id,
        moduleKey: "filterChangeModule",
        recordLabel: p.memberAccount || p.orderNumber,
        orderNumber: p.orderNumber,
        customerName: customer?.fullName,
        customerEmail: p.notifyEmail ?? customer?.email,
        scheduledDate: p.preD || p.planDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
      })
    )
  }
  for (const p of installPlans ?? []) {
    if (p.dispatchStatus !== "Draft" && p.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { orderNumber: p.orderNo })
    rows.push(
      withJob(p.scheduleJobId, {
        entityType: "install_plans",
        entityId: p.id,
        moduleKey: "installationModule",
        recordLabel: p.name || p.orderNo,
        orderNumber: p.orderNo,
        customerName: customer?.fullName ?? p.name,
        customerEmail: p.notifyEmail ?? customer?.email,
        scheduledDate: p.preInstalledDate || p.inputDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
      })
    )
  }
  for (const c of collections ?? []) {
    if (c.dispatchStatus !== "Draft" && c.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { customerId: c.customerId, orderNumber: c.orderNo })
    rows.push(
      withJob(c.scheduleJobId, {
        entityType: "collections",
        entityId: c.id,
        moduleKey: "collectionModule",
        recordLabel: c.accountName || c.orderNo,
        orderNumber: c.orderNo,
        customerName: customer?.fullName,
        customerEmail: c.notifyEmail ?? customer?.email,
        scheduledDate: c.preD || c.collectionDate,
        requestedTime: c.requestedTime,
        dispatchStatus: c.dispatchStatus,
        notes: c.note,
        rescheduleReason: c.rescheduleReason,
        createdAt: c.createdAt,
      })
    )
  }
  for (const r of repairPlans ?? []) {
    if (r.dispatchStatus !== "Draft" && r.dispatchStatus !== "Reschedule Requested") continue
    const customer = findCustomer(customers, saleListEntries, { orderNumber: r.orderNo })
    rows.push(
      withJob(r.scheduleJobId, {
        entityType: "repair_plans",
        entityId: r.id,
        moduleKey: "repairModule",
        recordLabel: r.accountName || r.orderNo,
        orderNumber: r.orderNo,
        customerName: customer?.fullName,
        customerEmail: r.notifyEmail ?? customer?.email,
        scheduledDate: r.preD || r.issuedDate,
        requestedTime: r.requestedTime,
        dispatchStatus: r.dispatchStatus,
        rescheduleReason: r.rescheduleReason,
        createdAt: r.createdAt,
      })
    )
  }

  return rows.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
}

// Reuses the exact same 4 plan queries + customers + sale list entries
// DispatchApprovalQueue already loads (same react-query cache keys, so
// mounting both this and the Dashboard panel costs zero extra network
// calls) — this is a second, more focused *view* over the identical data,
// not a second data source.
export function usePendingApprovalRows(): { rows: PendingApprovalRow[]; isPending: boolean } {
  const { data: filterChangePlans, isPending: p1 } = useFilterChangePlans()
  const { data: installPlans, isPending: p2 } = useInstallPlans()
  const { data: collections, isPending: p3 } = useCollections()
  const { data: repairPlans, isPending: p4 } = useRepairPlans()
  const { data: customers = [], isPending: p5 } = useCustomers()
  const { data: saleListEntries = [], isPending: p6 } = useSaleListEntries()
  const { data: scheduleJobs = [], isPending: p7 } = useScheduleJobs()

  const rows = React.useMemo(
    () => buildRows(filterChangePlans, installPlans, collections, repairPlans, customers, saleListEntries, scheduleJobs),
    [filterChangePlans, installPlans, collections, repairPlans, customers, saleListEntries, scheduleJobs]
  )

  return { rows, isPending: p1 || p2 || p3 || p4 || p5 || p6 || p7 }
}

function PendingStatusBadge({ status }: { status: "Draft" | "Reschedule Requested" }) {
  const { t } = useTranslation("dispatch")
  const tone: BadgeTone = status === "Draft" ? "warning" : "warning"
  const label = status === "Draft" ? t("pendingApprovalStatus") : t("rescheduleRequested")
  return <StatusBadge tone={tone} label={label} />
}

// A row's own unique key across all 4 modules — entityId alone isn't
// guaranteed unique between tables (they're separate uuid sequences), so
// every place that needs one (selection state, React keys) combines both,
// same as DispatchApprovalQueue's own row keys already do.
function rowKey(row: PendingApprovalRow): string {
  return `${row.entityType}:${row.entityId}`
}

type StatusFilter = "all" | "Draft" | "Reschedule Requested"

export function PendingApprovalsPanel({
  historyDefaultDate,
}: {
  // Forwarded to PendingApprovalsHistoryDialog's own initial date — the
  // Daily Report's own selected report date, when this panel is opened
  // from PendingApprovalsDialog on that page. Left undefined for the
  // Schedule page's own Pending Approvals tab, which has no report date of
  // its own; the history dialog falls back to today in that case.
  historyDefaultDate?: string
} = {}) {
  const { t } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { rows, isPending } = usePendingApprovalRows()
  const [reviewing, setReviewing] = React.useState<PendingApprovalRow | undefined>(undefined)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<"all" | DispatchEntityType>("all")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  // Purely a visual selection column (per-viewer, not persisted) — no bulk
  // action is wired to it yet, since none of the existing hooks this panel
  // reuses (useApproveDispatchItem etc.) support a batched call; each row's
  // own Review action stays the real way to act on it, same as before.
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Counts are always computed off the full, unfiltered row set — so the
  // tab labels and the Approval Summary cards report the same numbers
  // regardless of which tab or status filter is currently applied. Only the
  // table's own visible rows (below) actually narrow with those filters.
  const countsByType = React.useMemo(() => {
    const counts: Record<DispatchEntityType, number> = {
      filter_change_plans: 0,
      install_plans: 0,
      collections: 0,
      repair_plans: 0,
    }
    for (const r of rows) counts[r.entityType]++
    return counts
  }, [rows])

  const visibleRows = React.useMemo(
    () =>
      rows.filter(
        (r) => (activeTab === "all" || r.entityType === activeTab) && (statusFilter === "all" || r.dispatchStatus === statusFilter)
      ),
    [rows, activeTab, statusFilter]
  )

  const stopNumberByJobId = React.useMemo(
    () => computeStopNumbers(rows.filter((r) => r.routeSequence != null).map((r) => ({ id: r.entityId, technician: r.technician ?? "", scheduledDate: r.scheduledDate, routeSequence: r.routeSequence }))),
    [rows]
  )

  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(rowKey(r)))

  const toggleRow = React.useCallback((key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const toggleAllVisible = React.useCallback(
    (checked: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const r of visibleRows) {
          const key = rowKey(r)
          if (checked) next.add(key)
          else next.delete(key)
        }
        return next
      })
    },
    [visibleRows]
  )

  const columns: ColumnDef<PendingApprovalRow, unknown>[] = React.useMemo(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allVisibleSelected}
            onCheckedChange={(checked) => toggleAllVisible(checked === true)}
            aria-label={tCommon("all")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(rowKey(row.original))}
            onCheckedChange={(checked) => toggleRow(rowKey(row.original), checked === true)}
            onClick={(e) => e.stopPropagation()}
            aria-label={row.original.recordLabel}
          />
        ),
      },
      { accessorKey: "scheduledDate", header: t("dateColumn"), cell: ({ row }) => formatDate(row.original.scheduledDate) },
      { accessorKey: "moduleKey", header: t("jobTypeColumn"), cell: ({ row }) => t(row.original.moduleKey) },
      { accessorKey: "orderNumber", header: t("orderNoColumn"), cell: ({ row }) => row.original.orderNumber || "—" },
      { accessorKey: "customerName", header: t("customerColumn"), cell: ({ row }) => row.original.customerName || "—" },
      {
        accessorKey: "technician",
        header: t("technicianColumn"),
        cell: ({ row }) => (row.original.technician ? formatTechnicians(row.original.technician, row.original.technician2) : t("notAssigned")),
      },
      {
        id: "routeSequence",
        header: t("routeColumn"),
        cell: ({ row }) => {
          const n = stopNumberByJobId.get(row.original.entityId)
          return n != null ? t("routeStopShort", { n: String(n) }) : t("notAssigned")
        },
      },
      { accessorKey: "dispatchStatus", header: t("statusColumn"), cell: ({ row }) => <PendingStatusBadge status={row.original.dispatchStatus} /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button size="sm" variant="outline" onClick={() => setReviewing(row.original)}>
            {t("review")}
          </Button>
        ),
      },
    ],
    [t, tCommon, stopNumberByJobId, selected, allVisibleSelected, toggleAllVisible, toggleRow]
  )

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <ApprovalSummary countsByType={countsByType} />

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | DispatchEntityType)}>
            <TabsList>
              <TabsTrigger value="all">{t("allTabLabel", { count: String(rows.length) })}</TabsTrigger>
              {TYPE_TABS.map(({ value, tabLabelKey }) => (
                <TabsTrigger key={value} value={value}>
                  {t(tabLabelKey, { count: String(countsByType[value]) })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="Draft">{t("pendingApprovalStatus")}</SelectItem>
                <SelectItem value="Reschedule Requested">{t("rescheduleRequested")}</SelectItem>
              </SelectContent>
            </Select>
            {isAdmin && (
              <Button type="button" size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => setHistoryOpen(true)}>
                <History className="h-3.5 w-3.5" /> {t("historyButton")}
              </Button>
            )}
          </div>
        </div>

        <DataTable
          columns={columns}
          data={visibleRows}
          searchPlaceholder={t("searchPendingApprovals")}
          emptyMessage={t("noPendingApprovals")}
        />
      </CardContent>

      <ApprovalDetailDialog key={reviewing?.entityId ?? "none"} row={reviewing} onOpenChange={(open) => !open && setReviewing(undefined)} />
      {isAdmin && (
        <PendingApprovalsHistoryDialog
          key={historyOpen ? "open" : "closed"}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          defaultDate={historyDefaultDate}
        />
      )}
    </Card>
  )
}

// The same PendingApprovalsPanel, popped into a Dialog — for a call site
// that isn't already a Schedule-page tab (the Daily Report header's own
// "Pending Approvals" button, matching how DispatchApprovalQueue/
// StockMovementApprovalQueue are triggered from that same header). No
// separate data path: the panel's own hooks (usePendingApprovalRows,
// via the 4 plan queries) are the same react-query cache either call site
// reads, so approving/rejecting/rescheduling in here updates the header's
// own badge count live, the moment the mutation settles — closing the
// dialog needs no explicit refetch of its own.
export function PendingApprovalsDialog({
  open,
  onOpenChange,
  historyDefaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Forwarded straight to PendingApprovalsPanel — see its own comment.
  historyDefaultDate?: string
}) {
  const { t } = useTranslation("dispatch")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("pendingApprovalsDialogTitle")}</DialogTitle>
          <DialogDescription>{t("pendingApprovalsDialogDescription")}</DialogDescription>
        </DialogHeader>
        <PendingApprovalsPanel historyDefaultDate={historyDefaultDate} />
      </DialogContent>
    </Dialog>
  )
}

// The 4 per-type counts + a total, computed straight from countsByType so
// this can never disagree with the tab labels right above it — both are
// reading the exact same numbers.
function ApprovalSummary({ countsByType }: { countsByType: Record<DispatchEntityType, number> }) {
  const { t } = useTranslation("dispatch")
  const total = TYPE_TABS.reduce((sum, { value }) => sum + countsByType[value], 0)
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">{t("approvalSummaryTitle")}</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {TYPE_TABS.map(({ value, moduleKey }) => (
          <div key={value}>
            <p className="text-xs text-muted-foreground">{t(moduleKey)}</p>
            <p className="text-lg font-semibold">{countsByType[value]}</p>
          </div>
        ))}
        <div>
          <p className="text-xs text-muted-foreground">{t("totalPendingApprovals")}</p>
          <p className="text-lg font-semibold">{total}</p>
        </div>
      </div>
    </div>
  )
}

// Purely the count for the tab label — a separate light hook (rather than
// requiring every consumer to pull the full row list) since the Schedule
// page's tab trigger needs only the number, computed from the exact same
// underlying queries/cache.
export function usePendingApprovalsCount(): number {
  const { rows } = usePendingApprovalRows()
  return rows.length
}
