import { supabase } from "@/lib/supabase/client"
import type { SaleListEntry } from "@/lib/types"

type Row = {
  id: string
  order_number: string
  installed_date: string | null
  customer_id: string | null
  product_no: string
  s_c: string
  c_f: string
  c_t: string
  cp_y1_y2: string
  cp_start: string | null
  cp_end: string | null
  note: string | null
  status: string
  created_at: string
  cp_system_id: string | null
}

function fromRow(row: Row): SaleListEntry {
  return {
    id: row.id,
    orderNumber: row.order_number,
    installedDate: row.installed_date ?? undefined,
    customerId: row.customer_id ?? undefined,
    productNo: row.product_no,
    sc: row.s_c,
    cf: row.c_f,
    ct: row.c_t,
    cpY1Y2: row.cp_y1_y2,
    cpStart: row.cp_start ?? undefined,
    cpEnd: row.cp_end ?? undefined,
    note: row.note ?? undefined,
    status: row.status as SaleListEntry["status"],
    createdAt: row.created_at,
    cpSystemId: row.cp_system_id ?? undefined,
  }
}

function toRow(input: Partial<Omit<SaleListEntry, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.orderNumber !== undefined) row.order_number = input.orderNumber
  if (input.installedDate !== undefined) row.installed_date = input.installedDate || null
  if (input.customerId !== undefined) row.customer_id = input.customerId || null
  if (input.productNo !== undefined) row.product_no = input.productNo
  if (input.sc !== undefined) row.s_c = input.sc
  if (input.cf !== undefined) row.c_f = input.cf
  if (input.ct !== undefined) row.c_t = input.ct
  if (input.cpY1Y2 !== undefined) row.cp_y1_y2 = input.cpY1Y2
  if (input.cpStart !== undefined) row.cp_start = input.cpStart || null
  if (input.cpEnd !== undefined) row.cp_end = input.cpEnd || null
  if (input.note !== undefined) row.note = input.note || null
  if (input.status !== undefined) row.status = input.status
  if (input.cpSystemId !== undefined) row.cp_system_id = input.cpSystemId || null
  return row
}

export async function listSaleListEntries(): Promise<SaleListEntry[]> {
  const { data, error } = await supabase.from("sale_list_entries").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createSaleListEntry(input: Omit<SaleListEntry, "id" | "createdAt">): Promise<SaleListEntry> {
  const { data, error } = await supabase.from("sale_list_entries").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateSaleListEntry(id: string, input: Partial<Omit<SaleListEntry, "id" | "createdAt">>): Promise<SaleListEntry> {
  const { data, error } = await supabase.from("sale_list_entries").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteSaleListEntry(id: string): Promise<void> {
  const { error } = await supabase.from("sale_list_entries").delete().eq("id", id)
  if (error) throw error
}

export async function deleteSaleListEntries(ids: string[]): Promise<void> {
  const { error } = await supabase.from("sale_list_entries").delete().in("id", ids)
  if (error) throw error
}
