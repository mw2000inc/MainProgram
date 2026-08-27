import { supabase } from "@/lib/supabase/client"
import type { Product, StockMovement, Supplier } from "@/lib/types"

type ProductRow = {
  id: string
  name: string
  category: string
  supplier_id: string
  sku: string
  barcode: string | null
  stock_quantity: number
  min_stock_level: number
  purchase_price: number
  selling_price: number
  date_added: string
  last_updated: string
}

function productFromRow(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    supplierId: row.supplier_id,
    sku: row.sku,
    barcode: row.barcode ?? undefined,
    stockQuantity: row.stock_quantity,
    minStockLevel: row.min_stock_level,
    purchasePrice: Number(row.purchase_price),
    sellingPrice: Number(row.selling_price),
    dateAdded: row.date_added,
    lastUpdated: row.last_updated,
  }
}

function productToRow(input: Partial<Omit<Product, "id" | "dateAdded" | "lastUpdated">>) {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.category !== undefined) row.category = input.category
  if (input.supplierId !== undefined) row.supplier_id = input.supplierId
  if (input.sku !== undefined) row.sku = input.sku
  if (input.barcode !== undefined) row.barcode = input.barcode || null
  if (input.stockQuantity !== undefined) row.stock_quantity = input.stockQuantity
  if (input.minStockLevel !== undefined) row.min_stock_level = input.minStockLevel
  if (input.purchasePrice !== undefined) row.purchase_price = input.purchasePrice
  if (input.sellingPrice !== undefined) row.selling_price = input.sellingPrice
  return row
}

export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase.from("products").select("*").order("date_added", { ascending: false })
  if (error) throw error
  return (data as ProductRow[]).map(productFromRow)
}

export async function createProduct(input: Omit<Product, "id" | "dateAdded" | "lastUpdated">): Promise<Product> {
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
  product_id: string
  quantity_added: number
  quantity_removed: number
  second_hand_ready_quantity: number
  second_hand_repair_quantity: number
  demo_quantity: number
  reason: string
  user_id: string | null
  reference_number: string
  schedule_job_id: string | null
}

function movementFromRow(row: StockMovementRow): StockMovement {
  return {
    id: row.id,
    date: row.date,
    createdAt: row.created_at,
    productId: row.product_id,
    quantityAdded: row.quantity_added,
    quantityRemoved: row.quantity_removed,
    secondHandReadyQuantity: row.second_hand_ready_quantity,
    secondHandRepairQuantity: row.second_hand_repair_quantity,
    demoQuantity: row.demo_quantity,
    reason: row.reason as StockMovement["reason"],
    userId: row.user_id ?? undefined,
    referenceNumber: row.reference_number,
    scheduleJobId: row.schedule_job_id ?? undefined,
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
  const { data, error } = await supabase
    .from("stock_movements")
    .insert({
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
    })
    .select()
    .single()
  if (error) throw error
  const movement = movementFromRow(data as StockMovementRow)
  return resultingProductStock(movement.productId, movement)
}

// The product itself is never changed here (see stock-movement-form-dialog) — only
// quantity/reason/2nd-hand fields. A DB trigger reverses the old quantity delta and
// applies the new one so products.stock_quantity stays in sync with the edit.
export async function updateStockMovement(
  id: string,
  input: Pick<
    StockMovement,
    "quantityAdded" | "quantityRemoved" | "secondHandReadyQuantity" | "secondHandRepairQuantity" | "demoQuantity" | "reason"
  >
): Promise<StockMovementResult> {
  const { data, error } = await supabase
    .from("stock_movements")
    .update({
      quantity_added: input.quantityAdded,
      quantity_removed: input.quantityRemoved,
      second_hand_ready_quantity: input.secondHandReadyQuantity,
      second_hand_repair_quantity: input.secondHandRepairQuantity,
      demo_quantity: input.demoQuantity,
      reason: input.reason,
    })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  const movement = movementFromRow(data as StockMovementRow)
  return resultingProductStock(movement.productId, movement)
}

export async function deleteStockMovement(id: string): Promise<void> {
  // A DB trigger reverses this movement's effect on products.stock_quantity.
  const { error } = await supabase.from("stock_movements").delete().eq("id", id)
  if (error) throw error
}
