"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { History } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { DailyReportDateButton } from "@/components/dashboard/daily-report-date-button"
import { useFilterChangePlans, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { computeStopNumbers, formatTechnicians } from "@/components/schedule/schedule-columns"
import { ApprovalDetailDialog } from "@/components/schedule/approval-detail-dialog"
import { PendingApprovalsHistoryDialog } from "@/components/schedule/pending-approvals-history-dialog"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, todayIso, twoDaysFromNowIso } from "@/lib/utils"
import type { ColumnDef } from "@tanstack/react-table"
import type { Customer, SaleListEntry, ScheduleJob, DispatchStatus } from "@/lib/types"
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

// One row per dispatch item not yet fully locked in (Confirmed) or dead
// (Rejected) — three dispatch_status values on purpose, matching the
// Status filter's three real buckets:
// - Draft (never yet approved) and Reschedule Requested (customer-
//   declined-with-a-new-date, OR an admin's own request_reschedule_by_admin
//   — both land on this same dispatch_status, see that migration's own
//   comment on why no second status was invented for the admin-initiated
//   case) both genuinely need an ADMIN decision — the "Pending Approval"
//   filter bucket.
// - Pending Customer Confirmation has already been reviewed and sent —
//   it's now waiting on the CUSTOMER, not the admin — the "Approved" filter
//   bucket. Still shown here (rather than hidden entirely) so an admin can
//   see what's outstanding and reject it if something changes, but
//   ApprovalDetailDialog deliberately doesn't offer to re-send it.
// Confirmed and Rejected rows never appear here — this is deliberately the
// same dispatch_status this app already tracks, just a second, more
// focused surface for it than DispatchApprovalQueue's own Dashboard panel
// (which stays completely unchanged — this doesn't replace it, admins can
// use either).
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
  dispatchStatus: "Draft" | "Pending Customer Confirmation" | "Reschedule Requested"
  technician?: string
  technician2?: string
  routeSequence?: number
  notes?: string
  remarks?: string
  rescheduleReason?: string
  createdAt: string
  // The fields below carry each module's own raw, editable columns — added
  // so ApprovalDetailDialog can let an admin edit technician/date/notes/
  // details before approving, without a second query: every plan array is
  // already loaded here. Deliberately distinct from `technician`/`notes`
  // above, which are display-only and partly job-sourced (see withJob) —
  // editing needs the plan's OWN column, not a linked schedule_jobs value
  // that usually doesn't exist yet for a still-Draft row.
  //
  // The plan's own un-overridden date (planDate/inputDate/collectionDate/
  // issuedDate) — `scheduledDate` above is already preD-or-this collapsed;
  // this is kept separately so an edit form can show/compare both.
  baseDate: string
  // Plan-level technician column — filter_change_plans (serviceman),
  // repair_plans (th), and, since the 20260914000000 migration,
  // collections/install_plans (serviceman) all have one now. Always
  // present in practice; still optional on the type since it's populated
  // per-module in buildRows() below rather than guaranteed by a shared base
  // type.
  servicemanField?: string
  // The plan's own `note` column directly (filter_change_plans/
  // install_plans/collections have it; repair_plans doesn't).
  planNote?: string
  filterDetails?: { filterType: string; productNo: string; sc: string }
  collectionDetails?: { amount: number; ct: string }
}

// The three dispatch_status values this panel surfaces at all — see
// PendingApprovalRow's own comment for what each means/which filter bucket
// it belongs to. A type guard (not a plain array + .includes()) because
// TypeScript doesn't narrow a variable's type from an .includes() check —
// every caller below relies on this actually narrowing DispatchStatus |
// undefined down to PendingApprovalRow's own tighter union.
function isVisibleDispatchStatus(
  status: DispatchStatus | undefined
): status is PendingApprovalRow["dispatchStatus"] {
  return status === "Draft" || status === "Pending Customer Confirmation" || status === "Reschedule Requested"
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
    if (!isVisibleDispatchStatus(p.dispatchStatus)) continue
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
        baseDate: p.planDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
        servicemanField: p.serviceman,
        planNote: p.note,
        filterDetails: { filterType: p.filterType, productNo: p.productNo, sc: p.sc },
      })
    )
  }
  for (const p of installPlans ?? []) {
    if (!isVisibleDispatchStatus(p.dispatchStatus)) continue
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
        baseDate: p.inputDate,
        requestedTime: p.requestedTime,
        dispatchStatus: p.dispatchStatus,
        notes: p.note,
        rescheduleReason: p.rescheduleReason,
        createdAt: p.createdAt,
        servicemanField: p.serviceman,
        planNote: p.note,
      })
    )
  }
  for (const c of collections ?? []) {
    if (!isVisibleDispatchStatus(c.dispatchStatus)) continue
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
        baseDate: c.collectionDate,
        requestedTime: c.requestedTime,
        dispatchStatus: c.dispatchStatus,
        notes: c.note,
        rescheduleReason: c.rescheduleReason,
        createdAt: c.createdAt,
        servicemanField: c.serviceman,
        planNote: c.note,
        collectionDetails: { amount: c.amount, ct: c.ct },
      })
    )
  }
  for (const r of repairPlans ?? []) {
    if (!isVisibleDispatchStatus(r.dispatchStatus)) continue
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
        baseDate: r.issuedDate,
        requestedTime: r.requestedTime,
        dispatchStatus: r.dispatchStatus,
        rescheduleReason: r.rescheduleReason,
        createdAt: r.createdAt,
        servicemanField: r.th,
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

// Draft and Reschedule Requested both read as the same "Pending Approval"
// text here — both genuinely need an admin decision (see
// PendingApprovalRow's own comment), and the filter dropdown right above
// this table already groups them into that same single bucket, so the
// badge text and the filter option it corresponds to never disagree.
function PendingStatusBadge({ status }: { status: PendingApprovalRow["dispatchStatus"] }) {
  const { t } = useTranslation("dispatch")
  if (status === "Pending Customer Confirmation") {
    return <StatusBadge tone="success" label={t("approvedStatus")} />
  }
  return <StatusBadge tone="warning" label={t("pendingApprovalStatus")} />
}

// A row's own unique key across all 4 modules — entityId alone isn't
// guaranteed unique between tables (they're separate uuid sequences), so
// every place that needs one (selection state, React keys) combines both,
// same as DispatchApprovalQueue's own row keys already do.
function rowKey(row: PendingApprovalRow): string {
  return `${row.entityType}:${row.entityId}`
}

// "pendingApproval" covers both Draft and Reschedule Requested — both
// genuinely need an ADMIN decision, matching this panel's own "which rows
// need my attention" framing (see PendingApprovalRow's comment) — it isn't
// a 1:1 mapping onto a single dispatch_status the way "approved" is.
type StatusFilter = "all" | "pendingApproval" | "approved"

function matchesStatusFilter(status: PendingApprovalRow["dispatchStatus"], filter: StatusFilter): boolean {
  if (filter === "all") return true
  if (filter === "approved") return status === "Pending Customer Confirmation"
  return status === "Draft" || status === "Reschedule Requested"
}

// Additive, independent of statusFilter above — an admin can combine "only
// items due in the next 2 days" with any status bucket (e.g. "which of the
// upcoming ones are still unapproved"). "next2Days" is the DEFAULT (see its
// own useState below) — a rolling window (today through today+2 inclusive,
// 3 calendar days) meant to keep this queue's default view scoped to the
// near-term dispatch horizon rather than every pending item ever created,
// including "overdue" (anything before today) as its own explicit bucket
// rather than lumping it into "all" — a stale Draft from months ago reads
// very differently from one due tomorrow, and an admin should be able to
// isolate exactly that backlog. "all" remains available for the full,
// unfiltered history.
export type DateRangeFilter = "all" | "next2Days" | "overdue"

function matchesDateRangeFilter(scheduledDate: string, filter: DateRangeFilter): boolean {
  if (filter === "all") return true
  const today = todayIso()
  if (filter === "overdue") return scheduledDate < today
  return scheduledDate >= today && scheduledDate <= twoDaysFromNowIso()
}

export function PendingApprovalsPanel({
  historyDefaultDate,
  renderedInDialog,
}: {
  // Forwarded to PendingApprovalsHistoryDialog's own initial date — the
  // Daily Report's own selected report date, when this panel is opened
  // from PendingApprovalsDialog on that page. Left undefined for the
  // Schedule page's own Pending Approvals tab, which has no report date of
  // its own; the history dialog falls back to today in that case.
  historyDefaultDate?: string
  // True only when PendingApprovalsDialog renders this — that dialog's own
  // DialogContent is already a single bounded overflow-y-auto region (see
  // its own comment), so the table below must NOT also bound/scroll
  // itself in that case, or the two nest into a double scrollbar (an outer
  // one for the dialog, an inner one for the table, both visible at once).
  // Left false on the Schedule page's standalone tab, which has no
  // wrapping dialog to defer scrolling to — that case keeps its own
  // bounded, independently-scrolling table exactly as before.
  renderedInDialog?: boolean
} = {}) {
  const { t } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { rows, isPending } = usePendingApprovalRows()
  const updateFilterChangePlan = useUpdateFilterChangePlan()
  const updateInstallPlan = useUpdateInstallPlan()
  const updateCollection = useUpdateCollection()
  const updateRepairPlan = useUpdateRepairPlan()
  // Inline edit from the table's own Scheduled Date column — a narrower,
  // single-field version of ApprovalDetailDialog's own saveEditedFields
  // (that one saves a whole form's worth of edits together right before an
  // approve/accept call; this fires immediately on pick, with no approval
  // action attached). Each mutation's own onSuccess invalidates that
  // module's react-query cache, so `rows` (and therefore visibleRows,
  // countsByType, and the header's own badge counts) recompute
  // automatically against the new date — no separate refresh needed here
  // for the Date Range filter to immediately reflect the change.
  const updateScheduledDate = React.useCallback(
    (row: PendingApprovalRow, date: string) => {
      if (row.entityType === "filter_change_plans") {
        updateFilterChangePlan.mutate({ id: row.entityId, input: { preD: date } })
      } else if (row.entityType === "install_plans") {
        updateInstallPlan.mutate({ id: row.entityId, input: { preInstalledDate: date } })
      } else if (row.entityType === "collections") {
        updateCollection.mutate({ id: row.entityId, input: { preD: date } })
      } else if (row.entityType === "repair_plans") {
        updateRepairPlan.mutate({ id: row.entityId, input: { preD: date } })
      }
    },
    [updateFilterChangePlan, updateInstallPlan, updateCollection, updateRepairPlan]
  )
  const [reviewing, setReviewing] = React.useState<PendingApprovalRow | undefined>(undefined)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const { isFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  const [activeTab, setActiveTab] = React.useState<"all" | DispatchEntityType>("all")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all")
  // Defaults to the near-term dispatch window rather than every pending
  // item ever created — an admin opening this queue cold should see what's
  // actually due soon, not scroll past months of backlog first. Still just
  // as switchable as before (see the Select below); "all"/"overdue" are one
  // click away.
  const [dateRangeFilter, setDateRangeFilter] = React.useState<DateRangeFilter>("next2Days")
  // Purely a visual selection column (per-viewer, not persisted) — no bulk
  // action is wired to it yet, since none of the existing hooks this panel
  // reuses (useApproveDispatchItem etc.) support a batched call; each row's
  // own Review action stays the real way to act on it, same as before.
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Scoped to the active date filter (but NOT activeTab/statusFilter — see
  // visibleRows below for those) so the tab labels and the Approval
  // Summary cards genuinely reflect "what's in the current dispatch
  // window," matching whatever the Date Range Select is set to, rather
  // than a grand total across all time that never moves regardless of that
  // selection. Tab/status filters still only narrow the table's own visible
  // rows further, same as before.
  const dateFilteredRows = React.useMemo(
    () => rows.filter((r) => matchesDateRangeFilter(r.scheduledDate, dateRangeFilter)),
    [rows, dateRangeFilter]
  )

  const countsByType = React.useMemo(() => {
    const counts: Record<DispatchEntityType, number> = {
      filter_change_plans: 0,
      install_plans: 0,
      collections: 0,
      repair_plans: 0,
    }
    for (const r of dateFilteredRows) counts[r.entityType]++
    return counts
  }, [dateFilteredRows])

  const visibleRows = React.useMemo(
    () =>
      dateFilteredRows.filter(
        (r) => (activeTab === "all" || r.entityType === activeTab) && matchesStatusFilter(r.dispatchStatus, statusFilter)
      ),
    [dateFilteredRows, activeTab, statusFilter]
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
      {
        accessorKey: "scheduledDate",
        header: t("dateColumn"),
        // Admin-only, matching every other mutating action in this panel
        // (Approve/Reject/Reschedule inside ApprovalDetailDialog are all
        // gated the same way) — a technician sees the same plain read-only
        // date the whole table showed before this column became editable.
        cell: ({ row }) =>
          isAdmin ? (
            <DailyReportDateButton
              value={row.original.scheduledDate}
              onChange={(date) => updateScheduledDate(row.original, date)}
              className="h-7 px-2 text-xs"
            />
          ) : (
            formatDate(row.original.scheduledDate)
          ),
      },
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
    [t, tCommon, isAdmin, stopNumberByJobId, selected, allVisibleSelected, toggleAllVisible, toggleRow, updateScheduledDate]
  )

  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // Shared between the normal (in-Card), renderedInDialog, and full-screen
  // (portaled overlay) render below — same toolbar/table content in every
  // case, only which element actually owns the scrollbar differs. Both
  // isFullScreen and renderedInDialog defer to an ancestor that's already
  // its own single overflow-y-auto region (the portaled full-screen div
  // itself below, or PendingApprovalsDialog's own DialogContent) —
  // bounding the table too, in either case, would nest a second scrollbar
  // inside the first (both visible, both scrolling the same content —
  // confirmed exactly this way before this fix). "overflow-y-visible"
  // cancels DataTable's own hardcoded overflow-y-auto via tailwind-merge's
  // usual same-utility-group override (see cn()'s deduping — same
  // mechanism the Full-Screen toggle's own sm:max-w-none fix already
  // relies on), leaving overflow-x-auto for wide columns intact and
  // letting the table grow to its natural content height — still needed
  // even though DataTable's own scroll box no longer has a default
  // max-height of its own (h-full only, see that file's own comment): a
  // fullscreen/dialog ancestor DOES give it a real bounded height to
  // resolve h-full against, so overflow-y-auto would otherwise still open
  // a second, nested scroll region inside the dialog's own. Only the
  // Schedule page's standalone tab (neither full-screen nor in a dialog,
  // so nothing else nearby scrolls it) keeps its own bounded,
  // independently scrolling max-h-[60vh] box.
  const tableScrollClassName = isFullScreen || renderedInDialog ? "overflow-y-visible" : "max-h-[60vh]"

  const toolbarAndTable = (
    <>
      <ApprovalSummary countsByType={countsByType} />

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | DispatchEntityType)}>
          <TabsList>
            <TabsTrigger value="all">{t("allTabLabel", { count: String(dateFilteredRows.length) })}</TabsTrigger>
            {TYPE_TABS.map(({ value, tabLabelKey }) => (
              <TabsTrigger key={value} value={value}>
                {t(tabLabelKey, { count: String(countsByType[value]) })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Select value={dateRangeFilter} onValueChange={(v) => setDateRangeFilter(v as DateRangeFilter)}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next2Days">{t("next2DaysFilter")}</SelectItem>
              <SelectItem value="all">{t("allDatesFilter")}</SelectItem>
              <SelectItem value="overdue">{t("overdueFilter")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="pendingApproval">{t("pendingApprovalStatus")}</SelectItem>
              <SelectItem value="approved">{t("approvedStatus")}</SelectItem>
            </SelectContent>
          </Select>
          <FullScreenToggleButton isFullScreen={isFullScreen} onToggle={toggleFullScreen} />
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
        scrollContainerClassName={tableScrollClassName}
      />
    </>
  )

  const dialogs = (
    <>
      <ApprovalDetailDialog key={reviewing?.entityId ?? "none"} row={reviewing} onOpenChange={(open) => !open && setReviewing(undefined)} />
      {isAdmin && (
        <PendingApprovalsHistoryDialog
          key={historyOpen ? "open" : "closed"}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          defaultDate={historyDefaultDate}
        />
      )}
    </>
  )

  // Rendered via a portal straight to <body> rather than in place — this
  // component is sometimes nested inside a Radix DialogContent
  // (PendingApprovalsDialog below), which applies its own CSS transform for
  // centering; `position: fixed` on a descendant of a transformed ancestor
  // is positioned relative to THAT ancestor's box, not the real viewport,
  // per the CSS spec — a portal is what already lets Radix's own Dialog/
  // Popover escape that same trap, so the same fix applies here. Known,
  // accepted limitation in that nested case: Radix's own Escape-to-close
  // and this component's Escape-to-exit-fullscreen (see
  // use-fullscreen-toggle.ts) both listen independently, so Escape may
  // close the wrapping dialog too rather than only exiting full-screen —
  // the Minimize2 button always works correctly either way since it's a
  // direct click handler, not reliant on winning that race.
  //
  // pointer-events-auto + z-60 are load-bearing, not decorative, when
  // this is nested inside PendingApprovalsDialog: Radix's own DialogContent
  // (@radix-ui/react-dialog's DialogContentModal) sets
  // disableOutsidePointerEvents={context.open} on its DismissableLayer,
  // which — confirmed directly in @radix-ui/react-dismissable-layer's own
  // source — sets `document.body.style.pointerEvents = "none"` for as long
  // as that Dialog stays open, then explicitly re-enables it only on its
  // OWN Content node. This plain div, portaled straight to <body> as a
  // sibling of that Content node rather than a descendant of it, would
  // otherwise silently inherit that "none" — every click, row selection,
  // and scrollbar drag/wheel event on it would do nothing, with no visual
  // sign anything was wrong. z-60 (above every z-50 elsewhere in this
  // app, including Radix's own Dialog overlay/content) is the same fix
  // applied to stacking instead of pointer handling, so this never depends
  // on DOM-insertion-order tie-breaking to paint on top. overflow-y-auto
  // replaces the previous overflow-hidden here (see tableScrollClassName
  // above) so this div itself is the one scrolling region, not a second
  // one nested inside DataTable's own wrapper.
  if (isFullScreen && typeof document !== "undefined") {
    return (
      <>
        {createPortal(
          <div className="pointer-events-auto fixed inset-0 z-60 flex flex-col gap-4 overflow-y-auto bg-background p-6">
            {toolbarAndTable}
          </div>,
          document.body
        )}
        {dialogs}
      </>
    )
  }

  return (
    // Card's own base class includes overflow-hidden (for its rounded
    // corners) — CSS position:sticky treats ANY non-visible overflow as a
    // potential containing block, so left as-is here it'd stop the table
    // header's sticky positioning from ever reaching PendingApprovalsDialog's
    // own overflow-y-auto further up (the actual intended scrolling
    // ancestor once renderedInDialog stops the table bounding itself —
    // see tableScrollClassName above), silently breaking "sticky" into a
    // no-op. Only relevant in that one case: the standalone Schedule-page
    // tab's own table wrapper is already the nearest scrolling ancestor
    // (max-h-[60vh]), so Card's overflow-hidden never gets reached there
    // either way.
    <Card className={renderedInDialog ? "overflow-visible" : undefined}>
      <CardContent className="pt-6 space-y-4">{toolbarAndTable}</CardContent>
      {dialogs}
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
      <DialogContent
        // max-h-[80vh] + overflow-y-auto here is the ONE vertical scroll
        // boundary for this whole dialog — PendingApprovalsPanel's own
        // table is told not to bound/scroll itself too (renderedInDialog
        // below), specifically so this doesn't nest into a second,
        // independent scrollbar inside the first.
        className="sm:max-w-4xl max-h-[80vh] overflow-y-auto"
        // A misclick on the backdrop (or, via Radix's own "interact
        // outside" detection, opening the Status/Date Range Selects below
        // — their dropdowns portal outside this DialogContent's own DOM
        // subtree, and the panel's own full-screen mode portals straight
        // to document.body for the same reason its own comment gives —
        // Radix otherwise treats either as an outside interaction) used to
        // silently close this whole dialog. Same guard approval-detail-
        // dialog.tsx and DispatchApprovalQueue's own main dialog already
        // use — only an explicit Close (X) or Escape may dismiss this.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("pendingApprovalsDialogTitle")}</DialogTitle>
          <DialogDescription>{t("pendingApprovalsDialogDescription")}</DialogDescription>
        </DialogHeader>
        <PendingApprovalsPanel historyDefaultDate={historyDefaultDate} renderedInDialog />
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
