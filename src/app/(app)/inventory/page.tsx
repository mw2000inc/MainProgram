"use client"

import * as React from "react"
import Link from "next/link"
import { parseISO } from "date-fns"
import { ArrowLeftRight, Package, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { MonthYearFilter, type MonthYearValue } from "@/components/data-table/month-year-filter"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DateControl } from "@/components/dashboard/date-control"
import { ProductFormDialog } from "@/components/inventory/product-form-dialog"
import { getInventoryColumns, type ProductRow } from "@/components/inventory/inventory-columns"
import { useDeleteProduct, useProducts, useStockMovements, useSuppliers } from "@/lib/hooks/use-inventory"
import { useAuth } from "@/lib/auth/auth-context"
import { getStockStatus } from "@/lib/utils"
import { PRODUCT_CATEGORIES } from "@/lib/constants"
import type { Product, StockStatus } from "@/lib/types"

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function InventoryPage() {
  const { user, can } = useAuth()
  const { data: products = [], isPending: p1 } = useProducts()
  const { data: suppliers = [], isPending: p2 } = useSuppliers()
  const { data: movements = [], isPending: p3 } = useStockMovements()
  const deleteProduct = useDeleteProduct(user?.id ?? "")
  const isAdmin = user?.role === "admin"

  const [selectedDate, setSelectedDate] = React.useState(today)
  const [categoryFilter, setCategoryFilter] = React.useState<string>("all")
  const [statusFilter, setStatusFilter] = React.useState<"all" | StockStatus>("all")
  const [monthYear, setMonthYear] = React.useState<MonthYearValue>({ month: "all", year: "all" })
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Product | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<Product | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<ProductRow[]>([])

  const isPending = p1 || p2 || p3

  // Per-product balance as of the selected Date. Each bucket's live (all-time)
  // total is a real anchor — products.stock_quantity for Brand New (kept in sync
  // by a DB trigger on every movement) and a full sum of the movement ledger for
  // the other three buckets. Balance "as of" the selected date is that live total
  // minus the net effect of every movement dated AFTER the selected date — an
  // exact reconstruction from the ledger, not an approximation. In/Out Stock are
  // just that date's own movements.
  const conditionTotals = React.useMemo(() => {
    const totals = new Map<
      string,
      {
        secondHandReadyAsOf: number
        secondHandRepairAsOf: number
        demoAsOf: number
        netRegularAfter: number
        inOnDate: number
        outOnDate: number
      }
    >()
    for (const m of movements) {
      const entry = totals.get(m.productId) ?? {
        secondHandReadyAsOf: 0,
        secondHandRepairAsOf: 0,
        demoAsOf: 0,
        netRegularAfter: 0,
        inOnDate: 0,
        outOnDate: 0,
      }
      const isAfter = m.date > selectedDate
      const isOnDate = m.date === selectedDate

      if (isAfter) {
        entry.netRegularAfter += m.quantityAdded - m.quantityRemoved
        entry.secondHandReadyAsOf -= m.secondHandReadyQuantity
        entry.secondHandRepairAsOf -= m.secondHandRepairQuantity
        entry.demoAsOf -= m.demoQuantity
      } else {
        entry.secondHandReadyAsOf += m.secondHandReadyQuantity
        entry.secondHandRepairAsOf += m.secondHandRepairQuantity
        entry.demoAsOf += m.demoQuantity
      }

      if (isOnDate) {
        entry.inOnDate +=
          m.quantityAdded +
          Math.max(m.secondHandReadyQuantity, 0) +
          Math.max(m.secondHandRepairQuantity, 0) +
          Math.max(m.demoQuantity, 0)
        entry.outOnDate +=
          m.quantityRemoved +
          Math.max(-m.secondHandReadyQuantity, 0) +
          Math.max(-m.secondHandRepairQuantity, 0) +
          Math.max(-m.demoQuantity, 0)
      }
      totals.set(m.productId, entry)
    }
    return totals
  }, [movements, selectedDate])

  const rows: ProductRow[] = React.useMemo(
    () =>
      products.map((p) => {
        const totals = conditionTotals.get(p.id) ?? {
          secondHandReadyAsOf: 0,
          secondHandRepairAsOf: 0,
          demoAsOf: 0,
          netRegularAfter: 0,
          inOnDate: 0,
          outOnDate: 0,
        }
        const brandNewAsOf = p.stockQuantity - totals.netRegularAfter
        const balance = brandNewAsOf + totals.secondHandReadyAsOf + totals.secondHandRepairAsOf + totals.demoAsOf
        return {
          ...p,
          stockStatus: getStockStatus(p.stockQuantity, p.minStockLevel),
          supplierName: suppliers.find((s) => s.id === p.supplierId)?.name ?? "Unknown",
          brandNewQuantity: brandNewAsOf,
          secondHandReadyQuantity: totals.secondHandReadyAsOf,
          secondHandRepairQuantity: totals.secondHandRepairAsOf,
          demoQuantity: totals.demoAsOf,
          inStockOnDate: totals.inOnDate,
          outStockOnDate: totals.outOnDate,
          balance,
          pBalance: balance - (totals.inOnDate - totals.outOnDate),
        }
      }),
    [products, suppliers, conditionTotals]
  )

  const years = React.useMemo(
    () => Array.from(new Set(products.map((p) => parseISO(p.dateAdded).getFullYear()))).sort((a, b) => b - a),
    [products]
  )

  const scopedRows = React.useMemo(() => {
    return rows.filter((r) => {
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false
      if (statusFilter !== "all" && r.stockStatus !== statusFilter) return false
      const d = parseISO(r.dateAdded)
      if (monthYear.month !== "all" && d.getMonth() !== Number(monthYear.month)) return false
      if (monthYear.year !== "all" && d.getFullYear() !== Number(monthYear.year)) return false
      return true
    })
  }, [rows, categoryFilter, statusFilter, monthYear])

  const canEdit = can("inventory:edit")

  const columns = React.useMemo(
    () =>
      getInventoryColumns({
        canDelete: can("inventory:delete"),
        onDelete: (p) => setDeleting(p),
      }),
    [can]
  )

  const exportColumns = [
    { header: "SKU", key: "sku" },
    { header: "Description", key: "name" },
    { header: "Category", key: "category" },
    { header: "P_Balance", key: "pBalance" },
    { header: "In Stock", key: "inStockOnDate" },
    { header: "Out Stock", key: "outStockOnDate" },
    { header: "Balance", key: "balance" },
    { header: "Brand New", key: "brandNewQuantity" },
    { header: "2nd hand (ready)", key: "secondHandReadyQuantity" },
    { header: "2nd hand (need repair)", key: "secondHandRepairQuantity" },
    { header: "Demo", key: "demoQuantity" },
    { header: "Min Level", key: "minStockLevel" },
    { header: "Status", key: "stockStatus" },
    { header: "Date Added", key: "dateAdded" },
    { header: "Supplier", key: "supplierName" },
    ...(isAdmin ? [{ header: "Purchase Price", key: "purchasePrice" }] : []),
    { header: "Selling Price", key: "sellingPrice" },
  ]

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground">Track stock levels, pricing and suppliers.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/inventory/in-and-out">
            <Button variant="outline" className="gap-1.5">
              <ArrowLeftRight className="h-4 w-4" /> In &amp; Out Summary
            </Button>
          </Link>
          <PanelExportMenu columns={exportColumns} rows={filteredRows} fileName="inventory" />
          {can("inventory:add") && (
            <Button
              onClick={() => {
                setEditing(undefined)
                setFormOpen(true)
              }}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add Product
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4 items-start">
        <DateControl value={selectedDate} onChange={setSelectedDate} />

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={scopedRows}
              searchPlaceholder="Search by name, SKU, barcode..."
              onFilteredRowsChange={setFilteredRows}
              emptyMessage="No products found."
              onRowClick={
                canEdit
                  ? (p) => {
                      setEditing(p)
                      setFormOpen(true)
                    }
                  : undefined
              }
              toolbar={
                <>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {PRODUCT_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                    <SelectTrigger className="h-9 w-[150px]">
                      <SelectValue placeholder="Stock Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="in-stock">In Stock</SelectItem>
                      <SelectItem value="low-stock">Low Stock</SelectItem>
                      <SelectItem value="out-of-stock">Out of Stock</SelectItem>
                    </SelectContent>
                  </Select>
                  <MonthYearFilter value={monthYear} onChange={setMonthYear} years={years} />
                </>
              }
            />
          </CardContent>
        </Card>
      </div>

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} product={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete product?"
        description={`This will permanently remove ${deleting?.name ?? "this product"} from inventory.`}
        loading={deleteProduct.isPending}
        onConfirm={async () => {
          if (!deleting) return
          // The mutation's onError already toasts the reason (e.g. a product still
          // referenced by a past sale) — catch here so that rejection doesn't also
          // surface as an unhandled-error dev overlay on top of the toast.
          try {
            await deleteProduct.mutateAsync(deleting.id)
            setDeleting(undefined)
          } catch {
            // handled by the mutation's onError toast
          }
        }}
      />
    </div>
  )
}
