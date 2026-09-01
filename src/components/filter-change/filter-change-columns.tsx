"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { PlanStatusSelect } from "@/components/shared/plan-status-select"
import { InlineDateCell, InlineSelectCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
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
  if (source === "ct_completion") return <StatusBadge tone="secondary" label="Auto (C/T)" />
  if (source === "recurring_schedule") return <StatusBadge tone="secondary" label="Recurring Schedule" />
  return <span className="text-muted-foreground">Manual</span>
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
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "memberAccount",
      header: "Member Account#",
    },
    {
      accessorKey: "filterType",
      header: "Filter",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

// Widened, inline-editable column set for the Daily Report's own compact
// panel (see daily-report-section.tsx) — unlike the plain 4-column
// getFilterChangeColumns() above (reused read-only in several other
// places: Sale List, Member detail, the customer portal scan view), this
// surfaces the fields an admin most often needs to check or adjust for
// today's dispatch (Address, Contact, Plan D, Pre D, Acc D, Serviceman)
// directly in the panel — scrollable horizontally, no need to switch to
// the Maximize2 full-screen view for them. onFieldChange is left undefined
// for a non-admin (see daily-report-section.tsx), which falls every one of
// these back to plain read-only text — same on/off convention onStatusChange
// already uses on this file's other column sets. Every cell that can carry
// real content gets an explicit min-width wrapper so the column can't be
// squeezed narrower than that regardless of how little a given row's value
// fills it, which is what actually makes the panel's horizontal scrollbar
// engage reliably instead of every column just shrinking to fit.
export function getFilterChangeDailyReportColumns({
  onStatusChange,
  onFieldChange,
}: {
  onStatusChange?: (plan: FilterChangePlan, status: string) => void
  onFieldChange?: (
    plan: FilterChangePlan,
    patch: Partial<Pick<FilterChangePlan, "preD" | "serviceman" | "note">>
  ) => void
} = {}): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: "Order Number",
      cell: ({ row }) => <span className="inline-block min-w-[110px] font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "memberAccount",
      header: "Member Account#",
      cell: ({ row }) => <span className="inline-block min-w-[140px]">{row.original.memberAccount}</span>,
    },
    { accessorKey: "filterType", header: "Filter" },
    {
      accessorKey: "contactNumber",
      header: "Contact #",
      cell: ({ row }) => <span className="inline-block min-w-[130px]">{row.original.contactNumber || "—"}</span>,
    },
    {
      accessorKey: "address",
      header: "Address",
      cell: ({ row }) => <span className="inline-block min-w-[220px]">{row.original.address || "—"}</span>,
    },
    {
      accessorKey: "planDate",
      header: "Plan D",
      cell: ({ row }) => <span className="inline-block min-w-[100px]">{formatDate(row.original.planDate)}</span>,
    },
    {
      accessorKey: "preD",
      header: "Pre D",
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange) return <span className="inline-block min-w-[100px]">{plan.preD ? formatDate(plan.preD) : "—"}</span>
        return <InlineDateCell value={plan.preD} onCommit={(next) => onFieldChange(plan, { preD: next })} />
      },
    },
    {
      accessorKey: "accD",
      header: "Acc D",
      cell: ({ row }) => (
        <span className="inline-block min-w-[100px]">{row.original.accD ? formatDate(row.original.accD) : "—"}</span>
      ),
    },
    {
      accessorKey: "serviceman",
      header: "Serviceman",
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
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => {
        const plan = row.original
        if (!onFieldChange)
          return <span className="inline-block min-w-[180px] text-muted-foreground">{plan.note || "—"}</span>
        return (
          <InlineTextCell
            value={plan.note}
            placeholder="Note"
            className="min-w-[180px]"
            onCommit={(next) => onFieldChange(plan, { note: next })}
          />
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusCell plan={row.original} onStatusChange={onStatusChange} />,
    },
  ]
}

// Full AppSheet-parity column set, shown only in the panel's expanded view.
export function getFilterChangeExpandedColumns(): ColumnDef<FilterChangePlan, unknown>[] {
  return [
    {
      accessorKey: "orderNumber",
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    { accessorKey: "memberAccount", header: "Member Account#" },
    { accessorKey: "filterType", header: "Filter" },
    { accessorKey: "contactNumber", header: "Contact #" },
    { accessorKey: "address", header: "Address" },
    { accessorKey: "sc", header: "S/C" },
    { accessorKey: "productNo", header: "Product #" },
    {
      accessorKey: "preD",
      header: "Pre D",
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: "Acc D",
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    { accessorKey: "serviceman", header: "Serviceman" },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => <SourceCell source={row.original.source} />,
    },
    {
      accessorKey: "note",
      header: "Note",
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
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    { accessorKey: "memberAccount", header: "Member Account#" },
    { accessorKey: "filterType", header: "Filter" },
    { accessorKey: "contactNumber", header: "Contact #" },
    { accessorKey: "address", header: "Address" },
    {
      accessorKey: "planDate",
      header: "Plan D",
      cell: ({ row }) => formatDate(row.original.planDate),
    },
    {
      accessorKey: "preD",
      header: "Pre D",
      cell: ({ row }) => (row.original.preD ? formatDate(row.original.preD) : "—"),
    },
    {
      accessorKey: "accD",
      header: "Acc D",
      cell: ({ row }) => (row.original.accD ? formatDate(row.original.accD) : "—"),
    },
    { accessorKey: "productNo", header: "Product #" },
    { accessorKey: "serviceman", header: "Serviceman" },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => <SourceCell source={row.original.source} />,
    },
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
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
