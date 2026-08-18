"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StockStatusBadge } from "@/components/shared/status-badge"
import { formatDateTime, getStockStatus } from "@/lib/utils"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"

export type { StockMovementRow }

function signedQtyCell(qty: number) {
  if (qty > 0) return <span className="text-success font-medium">+{qty}</span>
  if (qty < 0) return <span className="text-danger font-medium">{qty}</span>
  return <span className="text-muted-foreground">-</span>
}

export function getStockMovementsColumns({
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  canEdit: boolean
  canDelete: boolean
  onEdit: (movement: StockMovementRow) => void
  onDelete: (movement: StockMovementRow) => void
}): ColumnDef<StockMovementRow, unknown>[] {
  const columns: ColumnDef<StockMovementRow, unknown>[] = [
    {
      accessorKey: "createdAt",
      header: "Date & Time",
      // The exact timestamp (not just the day) an entry was recorded — lets the admin
      // tell which movement happened first when several land on the same day.
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span>,
    },
    {
      accessorKey: "productName",
      header: "Product",
    },
    {
      accessorKey: "currentStock",
      header: "Previous Stock",
      cell: ({ row }) => <span className="font-medium">{row.original.currentStock}</span>,
    },
    {
      accessorKey: "quantityAdded",
      header: "Qty Added",
      cell: ({ row }) =>
        row.original.quantityAdded > 0 ? (
          <span className="text-success font-medium">+{row.original.quantityAdded}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "quantityRemoved",
      header: "Qty Removed",
      cell: ({ row }) =>
        row.original.quantityRemoved > 0 ? (
          <span className="text-danger font-medium">-{row.original.quantityRemoved}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "secondHandReadyQuantity",
      header: "2nd Hand (Ready)",
      cell: ({ row }) => signedQtyCell(row.original.secondHandReadyQuantity),
    },
    {
      accessorKey: "secondHandRepairQuantity",
      header: "2nd Hand (Repair)",
      cell: ({ row }) => signedQtyCell(row.original.secondHandRepairQuantity),
    },
    {
      accessorKey: "demoQuantity",
      header: "Demo",
      cell: ({ row }) => signedQtyCell(row.original.demoQuantity),
    },
    {
      accessorKey: "actualStock",
      header: "Current Stock",
    },
    {
      id: "status",
      header: "Status",
      // Flags the moment a stock-reducing movement pushes the product down to (or
      // past) its minimum level, so the admin sees the warning right on the ledger.
      cell: ({ row }) => (
        <StockStatusBadge status={getStockStatus(row.original.actualStock, row.original.minStockLevel)} />
      ),
    },
    {
      accessorKey: "reason",
      header: "Reason",
    },
    {
      accessorKey: "userName",
      header: "User",
    },
  ]

  if (canEdit || canDelete) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onClick={() => onEdit(row.original)}>
                <Pencil className="h-4 w-4" /> Edit
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={() => onDelete(row.original)}>
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    })
  }

  return columns
}
