import { supabase } from "@/lib/supabase/client"
import type { RepairPlanPart } from "@/lib/types"

type Row = {
  id: string
  repair_plan_id: string
  product_id: string | null
  custom_part_no: string | null
  custom_part_name: string | null
  in_out: "IN" | "OUT"
  quantity: number
  part_date: string
  created_at: string
  products: { sku: string; name: string } | null
}

type PartInput = {
  productId?: string
  customPartNo?: string
  customPartName?: string
  inOut: "IN" | "OUT"
  quantity: number
  partDate: string
}

function fromRow(row: Row): RepairPlanPart {
  return {
    id: row.id,
    repairPlanId: row.repair_plan_id,
    productId: row.product_id ?? undefined,
    // Falls back to the free-typed custom value whenever there's no real
    // catalog product behind this row (see the
    // repair_plan_parts_custom_entries migration) — the display columns
    // don't need to know or care which source it came from.
    productSku: row.products?.sku ?? row.custom_part_no ?? "",
    productName: row.products?.name ?? row.custom_part_name ?? "",
    inOut: row.in_out,
    quantity: row.quantity,
    partDate: row.part_date,
    createdAt: row.created_at,
  }
}

export async function listRepairPlanParts(repairPlanId: string): Promise<RepairPlanPart[]> {
  const { data, error } = await supabase
    .from("repair_plan_parts")
    .select("*, products(sku, name)")
    .eq("repair_plan_id", repairPlanId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createRepairPlanPart(repairPlanId: string, input: PartInput): Promise<RepairPlanPart> {
  const { data, error } = await supabase
    .from("repair_plan_parts")
    .insert({
      repair_plan_id: repairPlanId,
      product_id: input.productId ?? null,
      // Only ever set alongside a null product_id — a row identified by a
      // real catalog product doesn't also carry a stale custom value.
      custom_part_no: input.productId ? null : input.customPartNo ?? null,
      custom_part_name: input.productId ? null : input.customPartName ?? null,
      in_out: input.inOut,
      quantity: input.quantity,
      part_date: input.partDate,
    })
    .select("*, products(sku, name)")
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateRepairPlanPart(id: string, input: PartInput): Promise<RepairPlanPart> {
  const { data, error } = await supabase
    .from("repair_plan_parts")
    .update({
      product_id: input.productId ?? null,
      custom_part_no: input.productId ? null : input.customPartNo ?? null,
      custom_part_name: input.productId ? null : input.customPartName ?? null,
      in_out: input.inOut,
      quantity: input.quantity,
      part_date: input.partDate,
    })
    .eq("id", id)
    .select("*, products(sku, name)")
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteRepairPlanPart(id: string): Promise<void> {
  const { error } = await supabase.from("repair_plan_parts").delete().eq("id", id)
  if (error) throw error
}
