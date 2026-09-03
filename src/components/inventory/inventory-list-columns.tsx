"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { StatusBadge } from "@/components/shared/status-badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
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
  const { t } = useTranslation("status")
  return status === "pending" ? (
    <StatusBadge tone="warning" label={t("pending")} />
  ) : (
    <StatusBadge tone="success" label={t("approved")} />
  )
}

// A row's quantity is (almost) always entirely on one side — quantityAdded
// XOR quantityRemoved — for every write path in this app (manual entries,
// the sale-item trigger, the filter-change deduction). Falls back to
// showing both if a row genuinely has both set, rather than silently
// dropping one.
function movementTypeAndQty(row: StockMovementRow): { type: "add" | "deduct" | "addDeduct"; qty: number } {
  if (row.quantityAdded > 0 && row.quantityRemoved > 0) {
    return { type: "addDeduct", qty: row.quantityAdded - row.quantityRemoved }
  }
  if (row.quantityRemoved > 0) return { type: "deduct", qty: row.quantityRemoved }
  return { type: "add", qty: row.quantityAdded }
}

const TYPE_KEYS = { add: "typeAdd", deduct: "typeDeduct", addDeduct: "typeAddDeduct" } as const

function TypeCell({ row }: { row: StockMovementRow }) {
  const { t } = useTranslation("inventory")
  const { type } = movementTypeAndQty(row)
  return <span className={type === "deduct" ? "text-danger" : "text-success"}>{t(TYPE_KEYS[type])}</span>
}

function QtyCell({ row }: { row: StockMovementRow }) {
  const { type, qty } = movementTypeAndQty(row)
  return <span className="font-medium">{type === "deduct" ? `-${qty}` : `+${qty}`}</span>
}

// Compact set for the Daily Report panel itself.
export function getInventoryListColumns(): ColumnDef<StockMovementRow, unknown>[] {
  return [
    { accessorKey: "productName", header: () => <ColumnHeader tKey="item" ns="inventory" /> },
    { id: "type", header: () => <ColumnHeader tKey="type" ns="inventory" />, cell: ({ row }) => <TypeCell row={row.original} /> },
    { id: "qty", header: () => <ColumnHeader tKey="quantity" ns="fields" />, cell: ({ row }) => <QtyCell row={row.original} /> },
    { accessorKey: "reason", header: () => <ColumnHeader tKey="reason" ns="inventory" /> },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <InventoryStatusBadge status={row.original.status} />,
    },
  ]
}

// Full set, shown only in the panel's expanded (Maximize2) view — adds
// everything the "show useful information" list asked for beyond the
// compact columns above.
export function getInventoryListExpandedColumns(): ColumnDef<StockMovementRow, unknown>[] {
  return [
    { accessorKey: "productName", header: () => <ColumnHeader tKey="item" ns="inventory" /> },
    { id: "type", header: () => <ColumnHeader tKey="type" ns="inventory" />, cell: ({ row }) => <TypeCell row={row.original} /> },
    { id: "qty", header: () => <ColumnHeader tKey="quantity" ns="fields" />, cell: ({ row }) => <QtyCell row={row.original} /> },
    { accessorKey: "reason", header: () => <ColumnHeader tKey="reason" ns="inventory" /> },
    {
      accessorKey: "relatedCustomerName",
      header: () => <ColumnHeader tKey="relatedCustomer" ns="inventory" />,
      cell: ({ row }) => row.original.relatedCustomerName || "—",
    },
    {
      accessorKey: "relatedJobOrderNo",
      header: () => <ColumnHeader tKey="relatedJob" ns="inventory" />,
      cell: ({ row }) => row.original.relatedJobOrderNo || "—",
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <InventoryStatusBadge status={row.original.status} />,
    },
    { accessorKey: "userName", header: () => <ColumnHeader tKey="createdBy" ns="inventory" /> },
    {
      accessorKey: "approvedByName",
      header: () => <ColumnHeader tKey="approvedBy" ns="inventory" />,
      cell: ({ row }) => row.original.approvedByName || "—",
    },
    {
      accessorKey: "createdAt",
      header: () => <ColumnHeader tKey="time" ns="inventory" />,
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
  ]
}

// Print/export column headers stay in English regardless of interface
// language — deferred to the long-tail phase alongside the other modules'
// export column arrays (see the phased i18n plan).
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
