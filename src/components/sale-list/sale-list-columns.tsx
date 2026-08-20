"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn, formatDate } from "@/lib/utils"
import type { SaleListEntry } from "@/lib/types"

export type SaleListRow = SaleListEntry & { accountLabel: string }

export function StatusCell({ status }: { status: SaleListEntry["status"] }) {
  if (status === "RENT") {
    return (
      <Badge variant="outline" className="border-warning/20 bg-warning/10 text-warning font-medium">
        RENT
      </Badge>
    )
  }
  if (status === "INACTIVE") {
    return (
      <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
        INACTIVE
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-success/20 bg-success/10 text-success font-medium">
      ACTIVE
    </Badge>
  )
}

// Matches the old AppSheet "MW CP > Sales List" screen's column layout.
export function getSaleListColumns({
  canDelete,
  onDelete,
}: {
  canDelete: boolean
  onDelete: (entry: SaleListRow) => void
}): ColumnDef<SaleListRow, unknown>[] {
  const columns: ColumnDef<SaleListRow, unknown>[] = [
    {
      accessorKey: "orderNumber",
      header: "Order Number",
      cell: ({ row }) => <span className="font-medium">{row.original.orderNumber}</span>,
    },
    {
      accessorKey: "installedDate",
      header: "Installed Date",
      cell: ({ row }) => (row.original.installedDate ? formatDate(row.original.installedDate) : "—"),
    },
    {
      accessorKey: "accountLabel",
      header: "Account#",
      cell: ({ row }) => row.original.accountLabel || "—",
    },
    { accessorKey: "productNo", header: "Product#" },
    { accessorKey: "sc", header: "S/C" },
    { accessorKey: "cf", header: "C/F" },
    { accessorKey: "ct", header: "C/T" },
    { accessorKey: "cpY1Y2", header: "CP y1/y2" },
    {
      accessorKey: "cpStart",
      header: "CP start",
      cell: ({ row }) => (row.original.cpStart ? formatDate(row.original.cpStart) : "—"),
    },
    {
      accessorKey: "cpEnd",
      header: "CP end",
      cell: ({ row }) => (row.original.cpEnd ? formatDate(row.original.cpEnd) : "—"),
    },
    {
      accessorKey: "note",
      header: "Note",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.note || "—"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusCell status={row.original.status} />,
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

// INACTIVE renders strikethrough; RENT is highlighted (via StatusCell) but not
// struck — matches the AppSheet reference's two distinct visual treatments.
export function getSaleListRowClassName(entry: SaleListRow) {
  return cn(entry.status === "INACTIVE" && "line-through text-muted-foreground")
}

export const SALE_LIST_EXPORT_COLUMNS = [
  { header: "Order Number", key: "orderNumber" },
  { header: "Installed Date", key: "installedDate" },
  { header: "Account#", key: "accountLabel" },
  { header: "Product#", key: "productNo" },
  { header: "S/C", key: "sc" },
  { header: "C/F", key: "cf" },
  { header: "C/T", key: "ct" },
  { header: "CP y1/y2", key: "cpY1Y2" },
  { header: "CP start", key: "cpStart" },
  { header: "CP end", key: "cpEnd" },
  { header: "Note", key: "note" },
  { header: "Status", key: "status" },
]
