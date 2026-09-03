"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { InlineDateCell, InlineSelectCell } from "@/components/shared/inline-edit-cell"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { TECHNICIANS } from "@/lib/constants"
import { formatDate } from "@/lib/utils"
import type { FilterChangePlan } from "@/lib/types"

export const FILTER_CHANGE_STATUS_OPTIONS = ["Pending", "Completed", "Cancelled"] as const

// 'ct_completion' rows were auto-created/updated by a completed job
// recording its required filters (see the
// ct_filter_change_collection_inventory_link migration); 'recurring_schedule'
// rows were auto-generated every 3 months from the sale list entry's Plan D
// (see the filter_change_recurring_schedule migration) — 'manual' (the
// default) is anything typed in directly on this page, same as always.
function SourceCell({ source }: { source: FilterChangePlan["source"] }) {
  const { t } = useTranslation("fields")
  if (source === "ct_completion") return <StatusBadge tone="secondary" label={t("autoCT")} />
  if (source === "recurring_schedule") return <StatusBadge tone="secondary" label={t("recurringSchedule")} />
  return <span className="text-muted-foreground">{t("manual")}</span>
}

// A single interactive Status column when onStatusChange is provided
// (Daily Report + the standalone /filter-change page, admin-only) —
// replaces the old read-only badge plus the separate one-click "Mark
// Filter Changed" button with one Select that both shows and changes
// status in place. Falls back to the plain read-only badge everywhere else
// this column set is used (Sale List, Member detail, the customer portal
// scan view), unchanged from before.
function StatusCell({ plan, onStatusChange }: { plan: FilterChangePlan; onStatusChange?: (plan: FilterChangePlan, status: string) => void }) {
  if (!onStatusChange) return <PlanStatusBadge status={plan.status} />
  return (
    <PlanStatusSelect
      status={plan.status}
      options={FILTER_CHANGE_STATUS_OPTIONS}
      onChange={(next) => onStatusChange(plan, next)}
    />
  )
}

export function getFilterChangeColumns({
  onStatusChange,
}: {
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
} = {}): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "memberAccount",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
    },
    {
      accessorKey: "filterType",
      header: () => <ColumnHeader tKey="filter" ns="fields" />,
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

interface FilterChangeDailyReportColumnParams {
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
  onFieldChange?: (plan: FilterChangePlan, patch: Partial<Pick<FilterChangePlan, "preD" | "serviceman">>) => void
}

// One column-def builder shared by the compact and expanded (Maximize2)
// variants below, keyed by field, so a cell's editing behavior/min-width
// only ever has to be defined once regardless of which of the two lists
// includes it. onFieldChange left undefined for a non-admin (see
// daily-report-section.tsx) falls every editable cell back to plain
// read-only text — same on/off convention onStatusChange already uses on
// this file's other column sets.
function dailyReportColumnDefs({
  onStatusChange,
  onFieldChange,
}: FilterChangeDailyReportColumnParams): Record<
  "orderNumber" | "memberAccount" | "filterType" | "contactNumber" | "address" | "planDate" | "preD" | "accD" | "serviceman" | "status",
  ColumnDef<FilterChangePlan, unknown>
> {
  return {
    orderNumber: {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[110px] font-medium">{row.original.orderNumber}</span>,
    },
    memberAccount: {
      accessorKey: "memberAccount",
      header: () => <ColumnHeader tKey="memberAccount" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[140px]">{row.original.memberAccount}</span>,
    },
    filterType: { accessorKey: "filterType", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    contactNumber: {
      accessorKey: "contactNumber",
      header: () => <ColumnHeader tKey="contactNumber" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[130px]">{row.original.contactNumber || "—"}</span>,
    },
    address: {
      accessorKey: "address",
      header: () => <ColumnHeader tKey="address" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[220px]">{row.original.address || "—"}</span>,
    },
    planDate: {
      accessorKey: "planDate",
      header: () => <ColumnHeader tKey="planD" ns="fields" />,
      cell: ({ row }) => <span className="inline-block min-w-[100px]">{formatDate(row.original.planDate)}</span>,
    },
    preD: {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-[100px]">{plan.preD ? formatDate(plan.preD) : "—"}</span>
        return <InlineDateCell value={plan.preD} onCommit={(next) => onFieldChange(plan, { preD: next })} />
      },
    },
    accD: {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => (
        <span className="inline-block min-w-[100px]">{row.original.accD ? formatDate(row.original.accD) : "—"}</span>
      ),
    },
    serviceman: {
      accessorKey: "serviceman",
      header: () => <ColumnHeader tKey="serviceman" ns="fields" />,
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-[150px]">{plan.serviceman || "—"}</span>
        return (
          <InlineSelectCell
            value={plan.serviceman}
            options={TECHNICIANS}
            onCommit={(next) => onFieldChange(plan, { serviceman: next })}
          />
        )
      },
    },
    status: {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  }
}

// The Daily Report's own compact Filter Change panel — exactly the 5
// fields an admin needs at a glance for today's dispatch (Order Number,
// Filter, Plan D, Pre D, Acc D), in that order. Every other field
// (Member Account#, Contact #, Address, Serviceman, Status) is deliberately
// held back for the Maximize2 full-screen view (see
// getFilterChangeDailyReportExpandedColumns below) rather than crammed in
// here scrollable — unlike the plain 4-column getFilterChangeColumns()
// above (reused read-only in several other places: Sale List, Member
// detail, the customer portal scan view), which this doesn't touch at all.
export function getFilterChangeDailyReportColumns(
  params: FilterChangeDailyReportColumnParams = {}
): ColumnDef<FilterChangePlan, unknown>[] {
  const c = dailyReportColumnDefs(params)
  return [c.orderNumber, c.filterType, c.planDate, c.preD, c.accD]
}

// The same panel's Maximize2 full-screen view — the compact 5 above, plus
// the 5 held back from it (Member Account#, Contact #, Address, Serviceman,
// Status), for the full 10-column set with horizontal scrolling. Shares
// the exact same cell renderers (and onFieldChange/onStatusChange editing)
// as the compact view via dailyReportColumnDefs, so switching to full-
// screen never loses the ability to edit Pre D/Serviceman/Status.
export function getFilterChangeDailyReportExpandedColumns(
  params: FilterChangeDailyReportColumnParams = {}
): ColumnDef<FilterChangePlan, unknown>[] {
  const c = dailyReportColumnDefs(params)
  return [c.orderNumber, c.filterType, c.planDate, c.preD, c.accD, c.memberAccount, c.contactNumber, c.address, c.serviceman, c.status]
}

// Full AppSheet-parity column set, shown only in the panel's expanded view.
export function getFilterChangeExpandedColumns(): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    { accessorKey: "memberAccount", header: () => <ColumnHeader tKey="memberAccount" ns="fields" /> },
    { accessorKey: "filterType", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "address", header: () => <ColumnHeader tKey="address" ns="fields" /> },
    { accessorKey: "sc", header: () => <ColumnHeader tKey="sc" ns="fields" /> },
    { accessorKey: "productNo", header: () => <ColumnHeader tKey="productNo" ns="fields" /> },
    {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    { accessorKey: "serviceman", header: () => <ColumnHeader tKey="serviceman" ns="fields" /> },
    {
      accessorKey: "source",
      header: () => <ColumnHeader tKey="source" ns="fields" />,
      cell: ({ row }) => <SourceCell source={row.original.source} />,
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
  ]
}

// Standalone /filter-change page — matches the old AppSheet "MW CP > Filter
// Change" layout exactly (S/C and C/F intentionally excluded).
export function getFilterChangeFullColumns({
  canDelete,
  onDelete,
  onStatusChange,
}: {
  canDelete: boolean
  onDelete: (plan: FilterChangePlan) => void
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
}): ColumnDef<FilterChangePlan, unknown>[] {
  const columns: ColumnDef<FilterChangePlan, unknown>[] = [
    {
      accessorKey: "orderNumber",
      header: () => <ColumnHeader tKey="orderNumber" ns="fields" />,
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    { accessorKey: "memberAccount", header: () => <ColumnHeader tKey="memberAccount" ns="fields" /> },
    { accessorKey: "filterType", header: () => <ColumnHeader tKey="filter" ns="fields" /> },
    { accessorKey: "contactNumber", header: () => <ColumnHeader tKey="contactNumber" ns="fields" /> },
    { accessorKey: "address", header: () => <ColumnHeader tKey="address" ns="fields" /> },
    {
      accessorKey: "planDate",
      header: () => <ColumnHeader tKey="planD" ns="fields" />,
      cell: ({ row }) => formatDate(row.original.planDate),
    },
    {
      accessorKey: "preD",
      header: () => <ColumnHeader tKey="preD" ns="fields" />,
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: () => <ColumnHeader tKey="accD" ns="fields" />,
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    { accessorKey: "productNo", header: () => <ColumnHeader tKey="productNo" ns="fields" /> },
    { accessorKey: "serviceman", header: () => <ColumnHeader tKey="serviceman" ns="fields" /> },
    {
      accessorKey: "source",
      header: () => <ColumnHeader tKey="source" ns="fields" />,
      cell: ({ row }) => <SourceCell source={row.original.source} />,
    },
    {
      accessorKey: "note",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]

  if (canDelete) {
    columns.push({
      id: "delete",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-danger hover:text-danger"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(row.original)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      ),
    })
  }

  return columns
}

export const FILTER_CHANGE_EXPORT_COLUMNS = [
  { header: "Order Number", key: "orderNumber" },
  { header: "Member Account#", key: "memberAccount" },
  { header: "Filter", key: "filterType" },
  { header: "Contact #", key: "contactNumber" },
  { header: "Address", key: "address" },
  { header: "S/C", key: "sc" },
  { header: "Plan D", key: "planDate" },
  { header: "Pre D", key: "preD" },
  { header: "Acc D", key: "accD" },
  { header: "Product #", key: "productNo" },
  { header: "Serviceman", key: "serviceman" },
  { header: "Source", key: "source" },
  { header: "Note", key: "note" },
  { header: "Status", key: "status" },
]
