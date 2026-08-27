"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { formatDateTime } from "@/lib/utils"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"

// This is a pure history/view — no add/edit/delete/approve affordances
// anywhere on it (see the Daily Report panel wiring, which passes neither
// canAdd nor canDelete). Approving a movement stays exactly where it
// already was, on Inventory > In & Out — this panel only reads the same
// stock_movements ledger that page's own table already reads.

// 'pending'/'approved' are the only two real statuses this app has (see
// ApprovalStatusBadge on the In & Out page) — matches that badge's tones
// exactly so a movement reads the same way in both places.
function InventoryStatusBadge({ status }: { status: StockMovementRow["status"] }) {
  return status === "pending" ? <StatusBadge tone="warning" label="Pending" /> : <StatusBadge tone="success" label="Approved" />
}

// A row's quantity is (almost) always entirely on one side — quantityAdded
// XOR quantityRemoved — for every write path in this app (manual entries,
// the sale-item trigger, the filter-change deduction). Falls back to
// showing both if a row genuinely has both set, rather than silently
// dropping one.
function movementTypeAndQty(row: StockMovementRow): { type: string; qty: number } {
  if (row.quantityAdded > 0 && row.quantityRemoved > 0) {
    return { type: "Add/Deduct", qty: row.quantityAdded - row.quantityRemoved }
  }
  if (row.quantityRemoved > 0) return { type: "Deduct", qty: row.quantityRemoved }
  return { type: "Add", qty: row.quantityAdded }
}

function TypeCell({ row }: { row: StockMovementRow }) {
  const { type } = movementTypeAndQty(row)
  return <span className={type === "Deduct" ? "text-danger" : "text-success"}>{type}</span>
}

function QtyCell({ row }: { row: StockMovementRow }) {
  const { type, qty } = movementTypeAndQty(row)
  return <span className="font-medium">{type === "Deduct" ? `-${qty}` : `+${qty}`}</span>
}

// Compact set for the Daily Report panel itself.
export function getInventoryListColumns(): ColumnDef<StockMovementRow, unknown>[] {
  return [
    { accessorKey: "productName", header: "Item" },
    { id: "type", header: "Type", cell: ({ row }) => <TypeCell row={row.original} /> },
    { id: "qty", header: "Quantity", cell: ({ row }) => <QtyCell row={row.original} /> },
    { accessorKey: "reason", header: "Reason" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <InventoryStatusBadge status={row.original.status} />,
    },
  ]
}

// Full set, shown only in the panel's expanded (Maximize2) view — adds
// everything the "show useful information" list asked for beyond the
// compact columns above.
export function getInventoryListExpandedColumns(): ColumnDef<StockMovementRow, unknown>[] {
  return [
    { accessorKey: "productName", header: "Item" },
    { id: "type", header: "Type", cell: ({ row }) => <TypeCell row={row.original} /> },
    { id: "qty", header: "Quantity", cell: ({ row }) => <QtyCell row={row.original} /> },
    { accessorKey: "reason", header: "Reason" },
    {
      accessorKey: "relatedCustomerName",
      header: "Related Customer",
      cell: ({ row }) => row.original.relatedCustomerName || "—",
    },
    {
      accessorKey: "relatedJobOrderNo",
      header: "Related Job",
      cell: ({ row }) => row.original.relatedJobOrderNo || "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <InventoryStatusBadge status={row.original.status} />,
    },
    { accessorKey: "userName", header: "Created By" },
    {
      accessorKey: "approvedByName",
      header: "Approved By",
      cell: ({ row }) => row.original.approvedByName || "—",
    },
    {
      accessorKey: "createdAt",
      header: "Time",
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
  ]
}

export const INVENTORY_LIST_EXPORT_COLUMNS = [
  { header: "Item", key: "productName" },
  { header: "Reason", key: "reason" },
  { header: "Qty Added", key: "quantityAdded" },
  { header: "Qty Removed", key: "quantityRemoved" },
  { header: "Related Customer", key: "relatedCustomerName" },
  { header: "Related Job", key: "relatedJobOrderNo" },
  { header: "Status", key: "status" },
  { header: "Created By", key: "userName" },
  { header: "Approved By", key: "approvedByName" },
]
