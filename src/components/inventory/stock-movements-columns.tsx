"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, Trash2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StockStatusBadge, StatusBadge } from "@/components/shared/status-badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDateTime, getStockStatus } from "@/lib/utils"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"

export type { StockMovementRow }

// 'pending' rows are only ever produced by a completed job's recorded
// filter items (see the ct_filter_change_collection_inventory_link
// migration) — an ordinary manual/sale movement is always 'approved'.
function ApprovalStatusBadge({ status }: { status: StockMovementRow["status"] }) {
  const { t } = useTranslation("status")
  return status === "pending" ? (
    <StatusBadge tone="warning" label={t("pending")} />
  ) : (
    <StatusBadge tone="success" label={t("approved")} />
  )
}

function signedQtyCell(qty: number) {
  if (qty > 0) return <span className="text-success font-medium">+{qty}</span>
  if (qty < 0) return <span className="text-danger font-medium">{qty}</span>
  return <span className="text-muted-foreground">-</span>
}

function RowActionsCell({
  movement,
  canEdit,
  canDelete,
  canApprove,
  onEdit,
  onDelete,
  onApprove,
}: {
  movement: StockMovementRow
  canEdit: boolean
  canDelete: boolean
  canApprove: boolean
  onEdit: (movement: StockMovementRow) => void
  onDelete: (movement: StockMovementRow) => void
  onApprove: (movement: StockMovementRow) => void
}) {
  const { t } = useTranslation("common")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canApprove && movement.status === "pending" && (
          <DropdownMenuItem onClick={() => onApprove(movement)}>
            <Check className="h-4 w-4" /> {t("approve")}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem onClick={() => onEdit(movement)}>
            <Pencil className="h-4 w-4" /> {t("edit")}
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(movement)}>
            <Trash2 className="h-4 w-4" /> {t("delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function getStockMovementsColumns({
  canEdit,
  canDelete,
  canApprove,
  onEdit,
  onDelete,
  onApprove,
}: {
  canEdit: boolean
  canDelete: boolean
  canApprove: boolean
  onEdit: (movement: StockMovementRow) => void
  onDelete: (movement: StockMovementRow) => void
  onApprove: (movement: StockMovementRow) => void
}): ColumnDef<StockMovementRow, unknown>[] {
  const columns: ColumnDef<StockMovementRow, unknown>[] = [
    {
      accessorKey: "createdAt",
      header: () => <ColumnHeader tKey="dateTime" ns="inventory" />,
      // The exact timestamp (not just the day) an entry was recorded — lets the admin
      // tell which movement happened first when several land on the same day.
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      accessorKey: "sku",
      header: () => <ColumnHeader tKey="sku" ns="fields" />,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span>,
    },
    {
      accessorKey: "productName",
      header: () => <ColumnHeader tKey="product" ns="inventory" />,
    },
    {
      accessorKey: "currentStock",
      header: () => <ColumnHeader tKey="previousStock" ns="inventory" />,
      cell: ({ row }) => <span className="font-medium">{row.original.currentStock}</span>,
    },
    {
      accessorKey: "quantityAdded",
      header: () => <ColumnHeader tKey="qtyAdded" ns="inventory" />,
      cell: ({ row }) =>
        row.original.quantityAdded > 0 ? (
          <span className="text-success font-medium">+{row.original.quantityAdded}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "quantityRemoved",
      header: () => <ColumnHeader tKey="qtyRemoved" ns="inventory" />,
      cell: ({ row }) =>
        row.original.quantityRemoved > 0 ? (
          <span className="text-danger font-medium">-{row.original.quantityRemoved}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      accessorKey: "secondHandReadyQuantity",
      header: () => <ColumnHeader tKey="secondHandReady" ns="inventory" />,
      cell: ({ row }) => signedQtyCell(row.original.secondHandReadyQuantity),
    },
    {
      accessorKey: "secondHandRepairQuantity",
      header: () => <ColumnHeader tKey="secondHandRepair" ns="inventory" />,
      cell: ({ row }) => signedQtyCell(row.original.secondHandRepairQuantity),
    },
    {
      accessorKey: "demoQuantity",
      header: () => <ColumnHeader tKey="demo" ns="inventory" />,
      cell: ({ row }) => signedQtyCell(row.original.demoQuantity),
    },
    {
      accessorKey: "actualStock",
      header: () => <ColumnHeader tKey="currentStockHeader" ns="inventory" />,
    },
    {
      id: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      // Flags the moment a stock-reducing movement pushes the product down to (or
      // past) its minimum level, so the admin sees the warning right on the ledger.
      cell: ({ row }) => (
        <StockStatusBadge status={getStockStatus(row.original.actualStock, row.original.minStockLevel)} />
      ),
    },
    {
      accessorKey: "reason",
      header: () => <ColumnHeader tKey="reason" ns="inventory" />,
    },
    {
      accessorKey: "userName",
      header: () => <ColumnHeader tKey="user" ns="inventory" />,
    },
    {
      id: "approval",
      header: () => <ColumnHeader tKey="approval" ns="inventory" />,
      // Every existing movement (manual entries, sale deductions) is
      // 'approved' the instant it's inserted, same as always — this column
      // is only ever meaningfully "Pending" for a row auto-generated from a
      // completed job's recorded filter items, awaiting an admin's approval
      // before it actually affects stock.
      cell: ({ row }) => <ApprovalStatusBadge status={row.original.status} />,
    },
  ]

  if (canEdit || canDelete || canApprove) {
    columns.push({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActionsCell
          movement={row.original}
          canEdit={canEdit}
          canDelete={canDelete}
          canApprove={canApprove}
          onEdit={onEdit}
          onDelete={onDelete}
          onApprove={onApprove}
        />
      ),
    })
  }

  return columns
}
