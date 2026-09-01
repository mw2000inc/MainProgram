"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { CheckCircle2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { formatDate } from "@/lib/utils"
import type { FilterChangePlan } from "@/lib/types"

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

// onMarkDone is a Daily Report-only quick action ("Mark Filter Changed") —
// omitted everywhere else this compact column set is used (Sale List,
// Member detail, the customer portal scan view), so those keep rendering
// exactly as before. Only shown for a still-Pending row; there's nothing
// left to "mark done" once it's already Completed.
export function getFilterChangeColumns({
  onMarkDone,
}: {
  onMarkDone?: (plan: FilterChangePlan) => void
} = {}): ColumnDef<FilterChangePlan, unknown>[] {
  const columns: ColumnDef<FilterChangePlan, unknown>[] = [
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
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
  ]

  if (onMarkDone) {
    columns.push({
      id: "markDone",
      header: "",
      cell: ({ row }) =>
        row.original.status.toLowerCase() === "pending" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-success hover:text-success"
            onClick={(e) => {
              e.stopPropagation()
              onMarkDone(row.original)
            }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Mark Filter Changed
          </Button>
        ) : null,
    })
  }

  return columns
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
}: {
  canDelete: boolean
  onDelete: (plan: FilterChangePlan) => void
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
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
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
