"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ChevronRight, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Product, StockStatus } from "@/lib/types"

export type ProductRow = Product & {
  stockStatus: StockStatus
  supplierName: string
  brandNewQuantity: number
  secondHandReadyQuantity: number
  secondHandRepairQuantity: number
  demoQuantity: number
  // Derived, not stored, and computed as of the page's selected Date (defaults to
  // today): P_Balance = Balance minus that date's net movement (opening balance
  // for that day); In Stock/Out Stock = movement on that date only; Balance =
  // running total as of end of that date. See the Inventory page's conditionTotals.
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
      header: "SKU",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span>,
    },
    {
      accessorKey: "name",
      header: "Description",
      cell: ({ row }) => <div className="font-medium">{row.original.name}</div>,
    },
    { accessorKey: "category", header: "Category" },
    { accessorKey: "pBalance", header: "P_Balance" },
    { accessorKey: "inStockOnDate", header: "In Stock" },
    { accessorKey: "outStockOnDate", header: "Out Stock" },
    {
      accessorKey: "balance",
      header: "Balance",
      cell: ({ row }) => <span className="font-medium">{row.original.balance}</span>,
    },
    { accessorKey: "brandNewQuantity", header: "Brand New" },
    { accessorKey: "secondHandReadyQuantity", header: "2nd hand (ready)" },
    { accessorKey: "secondHandRepairQuantity", header: "2nd hand (need repair)" },
    { accessorKey: "demoQuantity", header: "Demo" },
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
