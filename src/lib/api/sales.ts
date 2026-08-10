import { supabase } from "@/lib/supabase/client"
import { logActivity } from "@/lib/api/activity"
import type { Sale, SaleItem, SaleService } from "@/lib/types"

type SaleItemRow = {
  id: string
  product_id: string
  quantity: number
  unit_price: number
  subtotal: number
}

type SaleServiceRow = {
  id: string
  name: string
  quantity: number
  unit_price: number
  subtotal: number
}

type SaleRow = {
  id: string
  invoice_number: string
  date: string
  customer_id: string
  sales_rep_id: string
  discount: number
  shipping: number
  total_amount: number
  payment_method: string
  payment_status: string
  shopify_order_id: string | null
  sale_items: SaleItemRow[]
  sale_services: SaleServiceRow[]
}

function itemFromRow(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    productId: row.product_id,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.subtotal),
  }
}

function serviceFromRow(row: SaleServiceRow): SaleService {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.subtotal),
  }
}

function fromRow(row: SaleRow): Sale {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    date: row.date,
    customerId: row.customer_id,
    salesRepId: row.sales_rep_id,
    items: (row.sale_items ?? []).map(itemFromRow),
    services: (row.sale_services ?? []).map(serviceFromRow),
    discount: Number(row.discount),
    // `|| 0` (not `?? 0`) also catches NaN from a row read before the shipping
    // column/migration exists, so the invoice never shows "NaN".
    shipping: Number(row.shipping) || 0,
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method as Sale["paymentMethod"],
    paymentStatus: row.payment_status as Sale["paymentStatus"],
    shopifyOrderId: row.shopify_order_id ?? undefined,
  }
}

function saleFieldsToRow(input: Partial<Omit<Sale, "id" | "invoiceNumber" | "items" | "services">>) {
  const row: Record<string, unknown> = {}
  if (input.date !== undefined) row.date = input.date
  if (input.customerId !== undefined) row.customer_id = input.customerId
  if (input.salesRepId !== undefined) row.sales_rep_id = input.salesRepId
  if (input.discount !== undefined) row.discount = input.discount
  if (input.shipping !== undefined) row.shipping = input.shipping
  if (input.totalAmount !== undefined) row.total_amount = input.totalAmount
  if (input.paymentMethod !== undefined) row.payment_method = input.paymentMethod
  if (input.paymentStatus !== undefined) row.payment_status = input.paymentStatus
  return row
}

const SALE_SELECT = "*, sale_items(*), sale_services(*)"

export async function listSales(): Promise<Sale[]> {
  const { data, error } = await supabase.from("sales").select(SALE_SELECT).order("date", { ascending: false })
  if (error) throw error
  return (data as SaleRow[]).map(fromRow)
}

export async function getSale(id: string): Promise<Sale | undefined> {
  const { data, error } = await supabase.from("sales").select(SALE_SELECT).eq("id", id).maybeSingle()
  if (error) throw error
  return data ? fromRow(data as SaleRow) : undefined
}

export async function createSale(input: Omit<Sale, "id" | "invoiceNumber">, actorId: string): Promise<Sale> {
  const { data: sale, error } = await supabase
    .from("sales")
    .insert(saleFieldsToRow(input))
    .select()
    .single()
  if (error) throw error

  const itemRows = input.items.map((it) => ({
    sale_id: sale.id,
    product_id: it.productId,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    subtotal: it.subtotal,
  }))
  // Each insert fires a trigger that deducts stock and records a "Sale" stock movement.
  const { error: itemsError } = await supabase.from("sale_items").insert(itemRows)
  if (itemsError) throw itemsError

  if (input.services.length > 0) {
    const serviceRows = input.services.map((s) => ({
      sale_id: sale.id,
      name: s.name,
      quantity: s.quantity,
      unit_price: s.unitPrice,
      subtotal: s.subtotal,
    }))
    // Services have no stock impact — no trigger fires for these inserts.
    const { error: servicesError } = await supabase.from("sale_services").insert(serviceRows)
    if (servicesError) throw servicesError
  }

  await logActivity(actorId, "Sale Added")
  return (await getSale(sale.id)) as Sale
}

// Editing a sale only ever updates existing line items in place (quantity/price),
// matching the mock store's original behavior — stock is never recalculated here.
// Services have no stock side-effect to worry about, so they're simply replaced
// wholesale (delete then re-insert) to support adding/removing service lines too.
export async function updateSale(
  id: string,
  input: Partial<Omit<Sale, "id" | "invoiceNumber">>,
  actorId: string
): Promise<Sale> {
  const { items, services, ...saleFields } = input
  if (Object.keys(saleFields).length > 0) {
    const { error } = await supabase.from("sales").update(saleFieldsToRow(saleFields)).eq("id", id)
    if (error) throw error
  }
  if (items) {
    for (const item of items) {
      if (!item.id) continue
      await supabase
        .from("sale_items")
        .update({ product_id: item.productId, quantity: item.quantity, unit_price: item.unitPrice, subtotal: item.subtotal })
        .eq("id", item.id)
    }
  }
  if (services) {
    const { error: deleteError } = await supabase.from("sale_services").delete().eq("sale_id", id)
    if (deleteError) throw deleteError
    if (services.length > 0) {
      const serviceRows = services.map((s) => ({
        sale_id: id,
        name: s.name,
        quantity: s.quantity,
        unit_price: s.unitPrice,
        subtotal: s.subtotal,
      }))
      const { error: insertError } = await supabase.from("sale_services").insert(serviceRows)
      if (insertError) throw insertError
    }
  }
  await logActivity(actorId, "Sale Edited")
  return (await getSale(id)) as Sale
}

export async function deleteSale(id: string, actorId: string): Promise<void> {
  const { error } = await supabase.from("sales").delete().eq("id", id)
  if (error) throw error
  await logActivity(actorId, "Sale Deleted")
}
