"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { CollectionPlan } from "@/lib/types"

// Set automatically (never by hand) the moment a completed job records
// filter items for this customer — see the
// ct_filter_change_collection_inventory_link migration. The actual filter
// list lives on schedule_job_filter_items, not duplicated here; this just
// flags that one exists.
function FilterChangeRequiredCell({ required }: { required: boolean | undefined }) {
  if (!required) return <span className="text-muted-foreground">—</span>
  return <StatusBadge tone="warning" label="Required" />
}

// 'recurring_schedule' rows are auto-generated from a sale list entry's C/T
// + CP Start/End (see the collection_recurring_schedule migration);
// 'ct_completion' ones from a completed job's filter items; 'manual' (the
// default) is anything typed in directly on this page.
function SourceCell({ source }: { source: CollectionPlan["source"] }) {
  if (source === "recurring_schedule") return <StatusBadge tone="secondary" label="Recurring" />
  if (source === "ct_completion") return <StatusBadge tone="secondary" label="Auto (C/T)" />
  return <span className="text-muted-foreground">Manual</span>
}

// Matches the old AppSheet Collection Plan columns, minus Product, S/C, and R/N.
export function getCollectionsColumns(): ColumnDef<CollectionPlan, unknown>[] {
  return [
    {
      accessorKey: "orderNo",
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNo}</span>,
    },
    { accessorKey: "accountName", header: "Member Account#" },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => formatCurrency(row.original.amount),
    },
    { accessorKey: "ct", header: "C/T" },
    {
      accessorKey: "collectionDate",
      header: "Plan D",
      cell: ({ row }) => formatDate(row.original.collectionDate),
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
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "filterChangeRequired",
      header: "Filter Change",
      cell: ({ row }) => <FilterChangeRequiredCell required={row.original.filterChangeRequired} />,
    },
  ]
}

// Full column set for the standalone /collection-plan list page — every
// field, unlike the trimmed dashboard-panel view above. When canEditDate is
// set, the Plan D cell itself becomes a click-to-edit shortcut straight into
// CollectionsFormDialog — skipping the row-click-then-Edit-button detour —
// since the schedule/date is the one thing an admin is most likely to be
// here to change. Non-admins (canEditDate false) still see the same cell,
// just as plain text — RLS (collections_update_admin) is the real
// enforcement either way, this is purely a UI affordance.
export function getCollectionsFullColumns({
  canDelete,
  canEditDate,
  onDelete,
  onEditDate,
}: {
  canDelete: boolean
  canEditDate: boolean
  onDelete: (entry: CollectionPlan) => void
  onEditDate: (entry: CollectionPlan) => void
}): ColumnDef<CollectionPlan, unknown>[] {
  const columns: ColumnDef<CollectionPlan, unknown>[] = [
    {
      accessorKey: "orderNo",
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNo}</span>,
    },
    { accessorKey: "accountName", header: "Member Account#" },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => formatCurrency(row.original.amount),
    },
    { accessorKey: "ct", header: "C/T" },
    {
      accessorKey: "collectionDate",
      header: "Plan D",
      cell: ({ row }) =>
        canEditDate ? (
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            onClick={(e) => {
              e.stopPropagation()
              onEditDate(row.original)
            }}
          >
            {formatDate(row.original.collectionDate)}
          </button>
        ) : (
          formatDate(row.original.collectionDate)
        ),
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
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "filterChangeRequired",
      header: "Filter Change",
      cell: ({ row }) => <FilterChangeRequiredCell required={row.original.filterChangeRequired} />,
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => <SourceCell source={row.original.source} />,
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

export const COLLECTIONS_EXPORT_COLUMNS = [
  { header: "Order Number", key: "orderNo" },
  { header: "Member Account#", key: "accountName" },
  { header: "Amount", key: "amount" },
  { header: "C/T", key: "ct" },
  { header: "Plan D", key: "collectionDate" },
  { header: "Pre D", key: "preD" },
  { header: "Acc D", key: "accD" },
  { header: "Note", key: "note" },
  { header: "Source", key: "source" },
  { header: "Status", key: "status" },
]
