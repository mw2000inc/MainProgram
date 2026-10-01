import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/inventory"
import { AUTOMATED_STOCK_MOVEMENT_REASONS } from "@/lib/constants"
import { useUsers } from "@/lib/hooks/use-misc"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { listRepairPlanIdsForParts } from "@/lib/api/repair-plan-parts"
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
  // Present only for an approved movement — who approved it (see
  // approveStockMovement). Used by the Daily Report's Inventory List, which
  // needs this alongside userName (who created it) for its audit display.
  approvedByName?: string
  // Same idea, present only for a rejected movement — who rejected it (see
  // rejectStockMovement). Used by StockMovementHistoryDialog.
  rejectedByName?: string
  // Present only for a movement traceable back to a schedule job (the
  // filter-change auto-deduction, old and new — see scheduleJobId) — the
  // customer/order that job was for, joined client-side the same way
  // productName/userName already are.
  relatedCustomerName?: string
  relatedJobOrderNo?: string
  // "Manual" for a row an admin typed into the Add/Edit Stock Movement
  // dialog, "System" for one written by a trigger (the sale-item, filter-
  // change, or repair-part deduction) — derived straight from the reason
  // value itself (see AUTOMATED_STOCK_MOVEMENT_REASONS' own comment on why
  // that's a reliable signal) rather than a separate stored column, so it
  // can never drift out of sync with what actually wrote the row.
  source: "Manual" | "System"
  // Set only on an Inventory List row that combines several movements of
  // the same item on one job (see groupInventoryListRows).
  mergedIds?: string[]
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
  const { data: scheduleJobs = [], isPending: p4 } = useScheduleJobs()
  const { data: customers = [], isPending: p5 } = useCustomers()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: repairPlans = [] } = useRepairPlans()
  const partIds = React.useMemo(
    () => [...new Set(movements.map((m) => m.repairPlanPartId).filter((id): id is string => !!id))].sort(),
    [movements]
  )
  const { data: repairPlanIdByPart = {} } = useQuery({
    queryKey: ["repairPlanIdsForParts", partIds],
    queryFn: () => listRepairPlanIdsForParts(partIds),
    enabled: partIds.length > 0,
  })

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
    // the balance shown for every later movement on the same product. A
    // 'rejected' entry (see the stock_movement_rejection migration) never
    // gets applied either — same exclusion, for the same reason.
    const actualStockByMovementId = new Map<string, number>()
    const currentStockByMovementId = new Map<string, number>()
    byProduct.forEach((entries, productId) => {
      const product = products.find((p) => p.id === productId)
      const netRegular = entries.reduce(
        (sum, e) => (e.status === "pending" || e.status === "rejected" ? sum : sum + e.quantityAdded - e.quantityRemoved),
        0
      )
      const liveRegular = product?.stockQuantity ?? netRegular
      const opening = liveRegular - netRegular

      const chronological = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      let running = opening
      for (const entry of chronological) {
        currentStockByMovementId.set(entry.id, running)
        if (entry.status !== "pending" && entry.status !== "rejected") {
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

    const fcById = new Map(filterChangePlans.map((p) => [p.id, p]))
    const installById = new Map(installPlans.map((p) => [p.id, p]))
    const repairById = new Map(repairPlans.map((p) => [p.id, p]))
    return movements.map((m) => {
      const product = products.find((p) => p.id === m.productId)
      const actualStock = actualStockByMovementId.get(m.id) ?? product?.stockQuantity ?? 0
      const job = m.scheduleJobId ? scheduleJobs.find((j) => j.id === m.scheduleJobId) : undefined
      const customer = job?.customerId ? customers.find((c) => c.id === job.customerId) : undefined
      // The job a trigger-created movement came from, for Related Customer /
      // Related Job: a schedule job, or else the Filter Change visit,
      // install or repair that queued it.
      const fc = !job && m.filterChangePlanId ? fcById.get(m.filterChangePlanId) : undefined
      const install = !job && m.installPlanId ? installById.get(m.installPlanId) : undefined
      const repairId = !job && m.repairPlanPartId ? repairPlanIdByPart[m.repairPlanPartId] : undefined
      const repair = repairId ? repairById.get(repairId) : undefined
      const related = job
        ? { customer: customer ? customer.companyName || customer.fullName : undefined, order: job.orderNo }
        : fc
          ? { customer: fc.memberAccount, order: fc.orderNumber }
          : install
            ? { customer: install.name, order: install.orderNo }
            : repair
              ? { customer: repair.accountName, order: repair.orderNo }
              : { customer: undefined, order: undefined }
      return {
        ...m,
        productName: product?.name ?? m.itemLabel ?? "Unknown",
        sku: product?.sku ?? "-",
        actualStock,
        currentStock: currentStockByMovementId.get(m.id) ?? actualStock,
        minStockLevel: product?.minStockLevel ?? 0,
        userName: users.find((u) => u.id === m.userId)?.name ?? "Unknown",
        approvedByName: m.approvedBy ? (users.find((u) => u.id === m.approvedBy)?.name ?? "Unknown") : undefined,
        rejectedByName: m.rejectedBy ? (users.find((u) => u.id === m.rejectedBy)?.name ?? "Unknown") : undefined,
        source: (AUTOMATED_STOCK_MOVEMENT_REASONS as readonly string[]).includes(m.reason) ? "System" : "Manual",
        relatedCustomerName: related.customer || undefined,
        relatedJobOrderNo: related.order || undefined,
      }
    })
  }, [movements, products, users, scheduleJobs, customers, filterChangePlans, installPlans, repairPlans, repairPlanIdByPart])

  return { data, isPending: p1 || p2 || p3 || p4 || p5 }
}

export function useCreateProduct() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: api.ProductCreateInput) => api.createProduct(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Product added successfully")
    },
    onError: (error: Error) => {
      console.error("Failed to add product:", error)
      toast.error(error.message || "Failed to add product")
    },
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
    onError: (error: Error) => {
      console.error("Failed to update product:", error)
      toast.error(error.message || "Failed to update product")
    },
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

// The grouped edit of an Inventory List row combining several movements:
// each changed entry is saved on its own, in turn, so every one keeps its own
// job link and stock effect.
export function useUpdateStockMovements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (updates: { id: string; input: Parameters<typeof api.updateStockMovement>[1] }[]) => {
      const results: api.StockMovementResult[] = []
      for (const u of updates) results.push(await api.updateStockMovement(u.id, u.input))
      return results
    },
    onSuccess: (results) => {
      toast.success(`Updated ${results.length} stock movement(s)`)
      const last = results.at(-1)
      if (last) warnIfLowStock(last)
    },
    onError: (error: Error) => toast.error(error.message || "Failed to update stock movements"),
    // Also after a partial failure — some entries may already be saved.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
    },
  })
}

export function useApproveStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, approvedBy, adjust }: { id: string; approvedBy: string; adjust?: { productId?: string; quantityRemoved?: number; quantityAdded?: number } }) =>
      api.approveStockMovement(id, approvedBy, adjust),
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

// No products/notifications invalidation like useApproveStockMovement above —
// rejecting never touches stock_quantity or raises a low/out-of-stock
// notification (see rejectStockMovement's own comment), so there's nothing
// there to refresh.
// Approve All Pending — approves each movement in turn (one update each, the
// same as a single approval, so the approval trigger applies every one), then
// refreshes stock and movements once, with one summary toast instead of one
// per item. Stops at the first failure and reports how many went through.
export function useApproveStockMovements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, approvedBy }: { ids: string[]; approvedBy: string }) => {
      let approved = 0
      try {
        for (const id of ids) {
          await api.approveStockMovement(id, approvedBy)
          approved += 1
        }
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { approved })
      }
      return { approved }
    },
    onSuccess: ({ approved }) => toast.success(`Approved ${approved} inventory item(s) — stock updated`),
    onError: (error: Error & { approved?: number }) =>
      toast.error(`Stopped after ${error.approved ?? 0} item(s): ${error.message || "Failed to approve"}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: productsKey })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
    },
  })
}

// Reject several pending movements (a combined Inventory List row) — no stock
// effect, one toast.
export function useRejectStockMovements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, rejectedBy }: { ids: string[]; rejectedBy: string }) => {
      for (const id of ids) await api.rejectStockMovement(id, rejectedBy)
      return { rejected: ids.length }
    },
    onSuccess: ({ rejected }) => toast.success(`Rejected ${rejected} inventory item(s)`),
    onError: (error: Error) => toast.error(error.message || "Failed to reject"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
    },
  })
}

export function useRejectStockMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rejectedBy }: { id: string; rejectedBy: string }) => api.rejectStockMovement(id, rejectedBy),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: stockMovementsKey })
      qc.invalidateQueries({ queryKey: ["activityLogs"] })
      toast.success("Stock movement rejected")
    },
    onError: (error: Error) => toast.error(error.message || "Failed to reject stock movement"),
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
