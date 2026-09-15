"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ChevronRight, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ColumnHeader } from "@/components/shared/column-header"
import type { Product, StockStatus } from "@/lib/types"

export type ProductRow = Product & {
  stockStatus: StockStatus
  supplierName: string
  brandNewQuantity: number
  secondHandReadyQuantity: number
  secondHandRepairQuantity: number
  demoQuantity: number
  // Computed as of the page's selected Date (defaults to today) whenever the
  // product has at least one stock_movements row: P_Balance = Balance minus
  // that date's net movement (opening balance for that day); In Stock/Out
  // Stock = movement on that date only; Balance = running total as of end
  // of that date. See the Inventory page's conditionTotals. A product with
  // no movement history at all (nothing in the ledger to compute from) uses
  // its own stored p.pBalance/inStock/outStock/balance instead of a
  // computed-from-nothing 0 — see that page's rows builder.
  pBalance: number
  inStockOnDate: number
  outStockOnDate: number
  balance: number
}

// Matches the old AppSheet "SKU REF" screen's column layout exactly.
export function getInventoryColumns({
  canDelete,
  onDelete,
}: {
  canDelete: boolean
  onDelete: (product: ProductRow) => void
}): ColumnDef<ProductRow, unknown>[] {
  const columns: ColumnDef<ProductRow, unknown>[] = [
    {
      accessorKey: "sku",
      header: () => <ColumnHeader tKey="sku" ns="fields" />,
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span>,
    },
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="description" ns="inventory" />,
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
    },
    { accessorKey: "category", header: () => <ColumnHeader tKey="category" ns="fields" /> },
    { accessorKey: "pBalance", header: () => <ColumnHeader tKey="pBalance" ns="inventory" /> },
    { accessorKey: "inStockOnDate", header: () => <ColumnHeader tKey="inStock" ns="inventory" /> },
    { accessorKey: "outStockOnDate", header: () => <ColumnHeader tKey="outStock" ns="inventory" /> },
    {
      accessorKey: "balance",
      header: () => <ColumnHeader tKey="balance" ns="inventory" />,
      cell: ({ row }) => <span className="font-medium">{row.original.balance}</span>,
    },
    { accessorKey: "brandNewQuantity", header: () => <ColumnHeader tKey="brandNew" ns="inventory" /> },
    // Unlike the columns above, this one is never derived from the movement
    // ledger — it's always the static value stored directly on the product
    // record (see the Product type's own comment), the same way AppSheet's
    // own Stock Balances screen has it.
    { accessorKey: "secondHand", header: () => <ColumnHeader tKey="secondHand" ns="inventory" /> },
    { accessorKey: "secondHandReadyQuantity", header: () => <ColumnHeader tKey="secondHandReadyShort" ns="inventory" /> },
    { accessorKey: "secondHandRepairQuantity", header: () => <ColumnHeader tKey="secondHandRepairShort" ns="inventory" /> },
    { accessorKey: "demoQuantity", header: () => <ColumnHeader tKey="demo" ns="inventory" /> },
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

  // Purely a visual "drill in" affordance, matching the AppSheet reference — the
  // click itself is handled by the table row (see the Inventory page's onRowClick).
  columns.push({
    id: "expand",
    header: "",
    cell: () => <ChevronRight className="h-4 w-4 text-muted-foreground" />,
  })

  return columns
}
