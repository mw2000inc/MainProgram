import { supabase } from "@/lib/supabase/client"
import type { Product, StockMovement, Supplier } from "@/lib/types"

type ProductRow = {
  id: string
  name: string
  category: string
  supplier_id: string | null
  sku: string
  barcode: string | null
  description: string | null
  stock_quantity: number
  min_stock_level: number
  purchase_price: number
  selling_price: number
  p_balance: number
  in_stock: number
  out_stock: number
  balance: number
  brand_new: number
  second_hand: number
  date_added: string
  last_updated: string
}

function productFromRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    supplierId: row.supplier_id ?? undefined,
    sku: row.sku,
    barcode: row.barcode ?? undefined,
    description: row.description ?? undefined,
    stockQuantity: row.stock_quantity,
    minStockLevel: row.min_stock_level,
    purchasePrice: Number(row.purchase_price),
    sellingPrice: Number(row.selling_price),
    pBalance: row.p_balance,
    inStock: row.in_stock,
    outStock: row.out_stock,
    balance: row.balance,
    brandNew: row.brand_new,
    secondHand: row.second_hand,
    dateAdded: row.date_added,
    lastUpdated: row.last_updated,
  }
}

function productToRow(input: Partial<Omit<Product, "id" | "dateAdded" | "lastUpdated">>) {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.category !== undefined) row.category = input.category
  if (input.supplierId !== undefined) row.supplier_id = input.supplierId || null
  if (input.sku !== undefined) row.sku = input.sku
  if (input.barcode !== undefined) row.barcode = input.barcode || null
  if (input.description !== undefined) row.description = input.description || null
  if (input.stockQuantity !== undefined) row.stock_quantity = input.stockQuantity
  if (input.minStockLevel !== undefined) row.min_stock_level = input.minStockLevel
  if (input.purchasePrice !== undefined) row.purchase_price = input.purchasePrice
  if (input.sellingPrice !== undefined) row.selling_price = input.sellingPrice
  if (input.pBalance !== undefined) row.p_balance = input.pBalance
  if (input.inStock !== undefined) row.in_stock = input.inStock
  if (input.outStock !== undefined) row.out_stock = input.outStock
  if (input.balance !== undefined) row.balance = input.balance
  if (input.brandNew !== undefined) row.brand_new = input.brandNew
  if (input.secondHand !== undefined) row.second_hand = input.secondHand
  return row
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").order("date_added", { ascending: false })
  if (error) throw error
  return (data as ProductRow[]).map(productFromRow)
}

// stockQuantity/minStockLevel/purchasePrice/sellingPrice are optional here —
// the Add Product form no longer collects them (see product-form-dialog's
// own comment); a new product's row falls back to the DB's own `not null
// default 0`, and stockQuantity is kept in sync afterward by stock
// movements exactly like every other product.
export type ProductCreateInput = Omit<
  Product,
  "id" | "dateAdded" | "lastUpdated" | "stockQuantity" | "minStockLevel" | "purchasePrice" | "sellingPrice"
> &
  Partial<Pick<Product, "stockQuantity" | "minStockLevel" | "purchasePrice" | "sellingPrice">>

export async function createProduct(input: ProductCreateInput): Promise<Product> {
  const { data, error } = await supabase.from("products").insert(productToRow(input)).select().single()
  if (error) throw error
  return productFromRow(data as ProductRow)
}

export async function updateProduct(id: string, input: Partial<Omit<Product, "id" | "dateAdded">>): Promise<Product> {
  const row = { ...productToRow(input), last_updated: new Date().toISOString().slice(0, 10) }
  const { data, error } = await supabase.from("products").update(row).eq("id", id).select().single()
  if (error) throw error
  return productFromRow(data as ProductRow)
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", id)
  if (error) {
    // 23503 = foreign key violation. Stock movements cascade-delete with the product,
    // but sale_items (real invoice history) intentionally does not — so this means the
    // product appears on at least one past sale and can't be removed without corrupting
    // that record.
    if (error.code === "23503") {
      throw new Error("Can't delete — this product is part of a past sale. Remove it from those sales first.")
    }
    throw error
  }
}

export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from("suppliers").select("*").order("name")
  if (error) throw error
  return data as Supplier[]
}

export async function createSupplier(input: Omit<Supplier, "id">): Promise<Supplier> {
  const { data, error } = await supabase.from("suppliers").insert(input).select().single()
  if (error) throw error
  return data as Supplier
}

type StockMovementRow = {
  id: string
  date: string
  created_at: string
  product_id: string | null
  quantity_added: number
  quantity_removed: number
  second_hand_ready_quantity: number
  second_hand_repair_quantity: number
  demo_quantity: number
  reason: string
  user_id: string | null
  reference_number: string
  schedule_job_id: string | null
  filter_change_plan_id?: string | null
  repair_plan_part_id?: string | null
  install_plan_id?: string | null
  repair_plan_id?: string | null
  item_label?: string | null
  status: string
  approved_at: string | null
  approved_by: string | null
  rejected_at: string | null
  rejected_by: string | null
  pending_action?: "edit" | "delete" | null
  pending_values?: Record<string, number | string> | null
  pending_requested_by?: string | null
  pending_requested_at?: string | null
  purpose?: string | null
  slip_type?: string | null
  added_on_inventory?: boolean | null
}

type MovementEditInput = Pick<
  StockMovement,
  "quantityAdded" | "quantityRemoved" | "secondHandReadyQuantity" | "secondHandRepairQuantity" | "demoQuantity" | "reason"
> & {
  // A different product for the item (only when changed) — its record, e.g.
  // the Filter Change, keeps its own Filter; stock moves between the two
  // products by the database (20261126000000).
  productId?: string
}

const editColumns = (input: MovementEditInput) => ({
  quantity_added: input.quantityAdded,
  quantity_removed: input.quantityRemoved,
  second_hand_ready_quantity: input.secondHandReadyQuantity,
  second_hand_repair_quantity: input.secondHandRepairQuantity,
  demo_quantity: input.demoQuantity,
  reason: input.reason,
  // A mapped product replaces any typed (unmapped) label.
  ...(input.productId ? { product_id: input.productId, item_label: null } : {}),
})

function changeRequestFromRow(row: StockMovementRow): StockMovement["changeRequest"] {
  if (row.pending_action !== "edit" && row.pending_action !== "delete") return undefined
  const v = row.pending_values ?? {}
  const num = (k: string) => (v[k] === undefined || v[k] === null ? undefined : Number(v[k]))
  return {
    action: row.pending_action,
    values:
      row.pending_action === "edit"
        ? {
            quantityAdded: num("quantity_added"),
            quantityRemoved: num("quantity_removed"),
            secondHandReadyQuantity: num("second_hand_ready_quantity"),
            secondHandRepairQuantity: num("second_hand_repair_quantity"),
            demoQuantity: num("demo_quantity"),
            reason: (v.reason as StockMovement["reason"]) ?? undefined,
          }
        : undefined,
    requestedBy: row.pending_requested_by ?? undefined,
    requestedAt: row.pending_requested_at ?? undefined,
  }
}

const clearedRequest = { pending_action: null, pending_values: null, pending_requested_by: null, pending_requested_at: null }

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

async function movementState(id: string) {
  const { data, error } = await supabase.from("stock_movements").select("*").eq("id", id).single()
  if (error) throw error
  return data as StockMovementRow
}

function movementFromRow(row: StockMovementRow): StockMovement {
  return {
    id: row.id,
    date: row.date,
    createdAt: row.created_at,
    productId: row.product_id ?? "",
    quantityAdded: row.quantity_added,
    quantityRemoved: row.quantity_removed,
    secondHandReadyQuantity: row.second_hand_ready_quantity,
    secondHandRepairQuantity: row.second_hand_repair_quantity,
    demoQuantity: row.demo_quantity,
    reason: row.reason as StockMovement["reason"],
    userId: row.user_id ?? undefined,
    referenceNumber: row.reference_number,
    scheduleJobId: row.schedule_job_id ?? undefined,
    filterChangePlanId: row.filter_change_plan_id ?? undefined,
    repairPlanPartId: row.repair_plan_part_id ?? undefined,
    installPlanId: row.install_plan_id ?? undefined,
    repairPlanId: row.repair_plan_id ?? undefined,
    itemLabel: row.item_label ?? undefined,
    status: (row.status as StockMovement["status"]) ?? "approved",
    approvedAt: row.approved_at ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    rejectedAt: row.rejected_at ?? undefined,
    rejectedBy: row.rejected_by ?? undefined,
    changeRequest: changeRequestFromRow(row),
    purpose: row.purpose ?? undefined,
    slipType: row.slip_type ?? undefined,
    addedOnInventory: !!row.added_on_inventory,
  }
}

export async function listStockMovements(): Promise<StockMovement[]> {
  // Order by the real creation timestamp, not the day-only `date` field — same-day
  // movements otherwise come back in an arbitrary order and scramble the running
  // stock-balance reconstruction on the Stock Movements page.
  const { data, error } = await supabase.from("stock_movements").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as StockMovementRow[]).map(movementFromRow)
}

export type StockMovementResult = {
  movement: StockMovement
  productName: string
  stockQuantity: number
  minStockLevel: number
}

// Reads the product's post-trigger stock level so callers can warn the admin right
// when a movement pushes it down to (or past) its minimum — the trigger that keeps
// stock_quantity in sync runs inside the same transaction as the insert/update, so
// it's already reflected by the time this follow-up read happens.
async function resultingProductStock(productId: string, movement: StockMovement): Promise<StockMovementResult> {
  const { data, error } = await supabase
    .from("products")
    .select("name, stock_quantity, min_stock_level")
    .eq("id", productId)
    .single()
  if (error) throw error
  const product = data as { name: string; stock_quantity: number; min_stock_level: number }
  return {
    movement,
    productName: product.name,
    stockQuantity: product.stock_quantity,
    minStockLevel: product.min_stock_level,
  }
}

export async function addStockMovement(input: Omit<StockMovement, "id" | "createdAt">): Promise<StockMovementResult> {
  const row = {
    date: input.date,
    product_id: input.productId,
    quantity_added: input.quantityAdded,
    quantity_removed: input.quantityRemoved,
    second_hand_ready_quantity: input.secondHandReadyQuantity,
    second_hand_repair_quantity: input.secondHandRepairQuantity,
    demo_quantity: input.demoQuantity,
    reason: input.reason,
    user_id: input.userId,
    reference_number: input.referenceNumber,
    // Inventory pages only (see StockMovement.addedOnInventory).
    ...(input.addedOnInventory ? { added_on_inventory: true } : {}),
  }
  let { data, error } = await supabase.from("stock_movements").insert(row).select().single()
  // Before the 20261125000000 migration the column doesn't exist yet: saved
  // without the mark rather than not at all.
  if (error && input.addedOnInventory && /added_on_inventory/.test(error.message)) {
    const { added_on_inventory: _mark, ...plain } = row as typeof row & { added_on_inventory?: boolean }
    void _mark
    ;({ data, error } = await supabase.from("stock_movements").insert(plain).select().single())
  }
  if (error) throw error
  const movement = movementFromRow(data as StockMovementRow)
  return resultingProductStock(movement.productId, movement)
}

// The product itself is never changed here (see stock-movement-form-dialog) — only
// quantity/reason/2nd-hand fields. A pending movement is changed directly (it
// hasn't touched stock). An APPROVED one isn't changed yet: the new values are
// stored as an edit request (pending_action 'edit') and stock stays as it is
// until an admin approves it — approveStockMovement then writes them, and a
// DB trigger corrects products.stock_quantity by the difference.
export async function updateStockMovement(id: string, input: MovementEditInput): Promise<StockMovementResult> {
  const current = await movementState(id)
  // Stock added on the Inventory pages is edited directly (no approval step):
  // the database corrects products.stock_quantity by the difference itself.
  const asRequest = current.status === "approved" && !current.added_on_inventory
  const { data, error } = await supabase
    .from("stock_movements")
    .update(
      asRequest
        ? { pending_action: "edit", pending_values: editColumns(input), pending_requested_by: await currentUserId(), pending_requested_at: new Date().toISOString() }
        : editColumns(input)
    )
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  const movement = movementFromRow(data as StockMovementRow)
  return resultingProductStock(movement.productId, movement)
}

// Delete removes the movement at once, whatever its status: a pending or
// rejected one never touched stock; an approved one has its quantity given
// back by a DB trigger (reverse_stock_movement). (An earlier "delete request"
// left on a row — pending_action 'delete' — still shows Delete pending and is
// removed by Approve or by deleting it again.) Returns "deleted" — kept as a
// result so callers don't change if requests come back.
export async function deleteStockMovement(id: string): Promise<"deleted" | "requested"> {
  const { error } = await supabase.from("stock_movements").delete().eq("id", id)
  if (error) throw error
  return "deleted"
}

// Admin-only (see stock_movements_update_admin RLS) — transitions a pending
// movement (from a completed job's recorded filter items) to approved,
// which is what a DB trigger actually reacts to by applying the quantity to
// products.stock_quantity. approvedBy is the current admin's own id, a
// real server-verified value the same way every other "who approved this"
// field in this app is (see the admin-users API route's comment).
//
// adjust: what the admin changed in the queue before approving (a different
// filter, or a different quantity) — written in the same update as the
// approval, so the approval trigger deducts the adjusted amount, not the
// originally queued one.
export async function approveStockMovement(
  id: string,
  approvedBy: string,
  adjust?: { productId?: string; quantityRemoved?: number; quantityAdded?: number }
): Promise<StockMovementResult> {
  // A requested edit/delete of an approved movement: apply it now.
  const current = await movementState(id)
  if (current.pending_action === "delete") {
    const before = movementFromRow(current)
    const { error } = await supabase.from("stock_movements").delete().eq("id", id)
    if (error) throw error
    return resultingProductStock(before.productId, before)
  }
  if (current.pending_action === "edit") {
    const v = current.pending_values ?? {}
    const { data, error } = await supabase
      .from("stock_movements")
      .update({
        ...v,
        ...(adjust?.quantityRemoved !== undefined ? { quantity_removed: adjust.quantityRemoved } : {}),
        ...(adjust?.quantityAdded !== undefined ? { quantity_added: adjust.quantityAdded } : {}),
        ...clearedRequest,
        approved_at: new Date().toISOString(),
        approved_by: approvedBy,
      })
      .eq("id", id)
      .select()
      .single()
    if (error) throw error
    const movement = movementFromRow(data as StockMovementRow)
    return resultingProductStock(movement.productId, movement)
  }
  const { data, error } = await supabase
    .from("stock_movements")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      // A Rejected item approved after all (Jan / cashout) is no longer rejected.
      rejected_at: null,
      rejected_by: null,
      ...(adjust?.productId ? { product_id: adjust.productId } : {}),
      ...(adjust?.quantityRemoved !== undefined ? { quantity_removed: adjust.quantityRemoved } : {}),
      ...(adjust?.quantityAdded !== undefined ? { quantity_added: adjust.quantityAdded } : {}),
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  const movement = movementFromRow(data as StockMovementRow)
  return resultingProductStock(movement.productId, movement)
}

// Admin-only (see stock_movements_update_admin RLS) — transitions a pending
// movement to rejected instead of approved. Unlike approveStockMovement,
// no trigger reacts to this at all (see the stock_movement_rejection
// migration's own comment) — every trigger that applies a quantity to
// products.stock_quantity is scoped specifically to a 'pending' ->
// 'approved' transition, so a rejected movement genuinely never touches
// stock rather than applying it and then needing to undo it. No
// resultingProductStock() call for that same reason — there's no stock
// change to report or warn about. rejectedBy is the current admin's own
// id, same real server-verified pattern as approveStockMovement's
// approvedBy.
export async function rejectStockMovement(id: string, rejectedBy: string): Promise<StockMovement> {
  // Rejecting a requested edit/delete drops the request; the movement stays
  // approved exactly as it was.
  const current = await movementState(id)
  if (current.pending_action) {
    const { data, error } = await supabase.from("stock_movements").update(clearedRequest).eq("id", id).select().single()
    if (error) throw error
    return movementFromRow(data as StockMovementRow)
  }
  const { data, error } = await supabase
    .from("stock_movements")
    .update({ status: "rejected", rejected_at: new Date().toISOString(), rejected_by: rejectedBy })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return movementFromRow(data as StockMovementRow)
}
