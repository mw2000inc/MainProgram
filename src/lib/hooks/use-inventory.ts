import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/inventory"
import { useUsers } from "@/lib/hooks/use-misc"
import type { Product, StockMovement, Supplier } from "@/lib/types"
import { getStockStatus } from "@/lib/utils"
import { toast } from "sonner"

export type StockMovementRow = StockMovement & {
  productName: string
  sku: string
  actualStock: number
  currentStock: number
  minStockLevel: number
  userName: string
}

function warnIfLowStock(result: api.StockMovementResult) {
  const status = getStockStatus(result.stockQuantity, result.minStockLevel)
  if (status === "out-of-stock") {
    toast.warning(`${result.productName} is now out of stock`)
  } else if (status === "low-stock") {
    toast.warning(`${result.productName} is at/below its minimum stock level (${result.stockQuantity} left)`)
  }
}

export const productsKey = ["products"] as const
export const suppliersKey = ["suppliers"] as const
export const stockMovementsKey = ["stockMovements"] as const

export function useProducts() {
  return useQuery({ queryKey: productsKey, queryFn: api.listProducts })
}

export function useSuppliers() {
  return useQuery({ queryKey: suppliersKey, queryFn: api.listSuppliers })
}

export function useStockMovements() {
  return useQuery({ queryKey: stockMovementsKey, queryFn: api.listStockMovements })
}

// Joins raw stock_movements with product/user info and reconstructs each entry's
// running stock balance (Previous/Current Stock) — shared by the Stock Movements
// page and the Inventory "In & Out Summary" drilldown so the two never drift.
export function useStockMovementRows() {
  const { data: movements = [], isPending: p1 } = useStockMovements()
  const { data: products = [], isPending: p2 } = useProducts()
  const { data: users = [], isPending: p3 } = useUsers()

  const data = React.useMemo<StockMovementRow[]>(() => {
    // Group per product so we can walk each product's own history in true creation
    // order (via createdAt, not array position — Postgres doesn't guarantee same-day
    // rows come back in insertion order) and rebuild the stock level as it was at
    // each point in time, rather than stamping every row with today's live quantity.
    const byProduct = new Map<string, StockMovement[]>()
    movements.forEach((m) => {
      const list = byProduct.get(m.productId) ?? []
      list.push(m)
      byProduct.set(m.productId, list)
    })

    // Current Stock = the combined balance going INTO a movement (opening); Actual
    // Stock = the combined balance coming OUT of it (Current Stock + Qty Added -
    // Qty Removed + 2nd Hand). Both pools count toward this single running total —
    // only the product's own stock_quantity column tracks the regular pool, so we
    // back-solve the combined opening balance from the live totals of both.
    //
    // A 'pending' entry (from a completed job's recorded filter items, not yet
    // admin-approved) has NOT actually been applied to stock_quantity — it must
    // be excluded from both the opening back-solve and the running walk, or it
    // would show a stock change that hasn't really happened yet, and corrupt
    // the balance shown for every later movement on the same product.
    const actualStockByMovementId = new Map<string, number>()
    const currentStockByMovementId = new Map<string, number>()
    byProduct.forEach((entries, productId) => {
      const product = products.find((p) => p.id === productId)
      const netRegular = entries.reduce(
        (sum, e) => (e.status === "pending" ? sum : sum + e.quantityAdded - e.quantityRemoved),
        0
      )
      const liveRegular = product?.stockQuantity ?? netRegular
      const opening = liveRegular - netRegular

      const chronological = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      let running = opening
      for (const entry of chronological) {
        currentStockByMovementId.set(entry.id, running)
        if (entry.status !== "pending") {
          running +=
            entry.quantityAdded -
            entry.quantityRemoved +
            entry.secondHandReadyQuantity +
            entry.secondHandRepairQuantity +
            entry.demoQuantity
        }
        actualStockByMovementId.set(entry.id, running)
      }
    })

    return movements.map((m) => {
      const product = products.find((p) => p.id === m.productId)
      const actualStock = actualStockByMovementId.get(m.id) ?? product?.stockQuantity ?? 0
      return {
        ...m,
        productName: product?.name ?? "Unknown",
        sku: product?.sku ?? "-",
        actualStock,
        currentStock: currentStockByMovementId.get(m.id) ?? actualStock,
        minStockLevel: product?.minStockLevel ?? 0,
        userName: users.find((u) => u.id === m.userId)?.name ?? "Unknown",
      }
    })
  }, [movements, products, users])

  return { data, isPending: p1 || p2 || p3 }
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<Product, "id" | "dateAdded" | "lastUpdated">) => api.createProduct(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Product added successfully")
    },
    onError: () => toast.error("Failed to add product"),
  })
}

export function useUpdateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<Product, "id" | "dateAdded">> }) =>
      api.updateProduct(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Product updated successfully")
    },
    onError: () => toast.error("Failed to update product"),
  })
}

export function useDeleteProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Product deleted")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete product"),
  })
}

export function useCreateSupplier() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<Supplier, "id">) => api.createSupplier(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: suppliersKey })
      toast.success("Supplier added successfully")
    },
    onError: () => toast.error("Failed to add supplier"),
  })
}

export function useAddStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<StockMovement, "id" | "createdAt">) => api.addStockMovement(input),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Stock movement recorded")
      warnIfLowStock(result)
    },
    onError: () => toast.error("Failed to record stock movement"),
  })
}

export function useUpdateStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: Pick<
        StockMovement,
        "quantityAdded" | "quantityRemoved" | "secondHandReadyQuantity" | "secondHandRepairQuantity" | "demoQuantity" | "reason"
      >
    }) => api.updateStockMovement(id, input),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Stock movement updated")
      warnIfLowStock(result)
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update stock movement"),
  })
}

export function useApproveStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approvedBy }: { id: string; approvedBy: string }) => api.approveStockMovement(id, approvedBy),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success(`${result.productName} stock updated`)
      warnIfLowStock(result)
    },
    onError: (error: Error) => toast.error(error.message || "Failed to approve stock movement"),
  })
}

export function useDeleteStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteStockMovement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Stock movement deleted")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to delete stock movement"),
  })
}
