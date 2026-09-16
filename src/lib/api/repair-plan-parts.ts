import { supabase } from "@/lib/supabase/client"
import type { RepairPlanPart } from "@/lib/types"

type Row = {
  id: string
  repair_plan_id: string
  product_id: string
  in_out: "IN" | "OUT"
  quantity: number
  created_at: string
  products: { sku: string; name: string } | null
}

function fromRow(row: Row): RepairPlanPart {
  return {
    id: row.id,
    repairPlanId: row.repair_plan_id,
    productId: row.product_id,
    productSku: row.products?.sku ?? "",
    productName: row.products?.name ?? "",
    inOut: row.in_out,
    quantity: row.quantity,
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

export async function createRepairPlanPart(
  repairPlanId: string,
  input: { productId: string; inOut: "IN" | "OUT"; quantity: number }
): Promise<RepairPlanPart> {
  const { data, error } = await supabase
    .from("repair_plan_parts")
    .insert({
      repair_plan_id: repairPlanId,
      product_id: input.productId,
      in_out: input.inOut,
      quantity: input.quantity,
    })
    .select("*, products(sku, name)")
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteRepairPlanPart(id: string): Promise<void> {
  const { error } = await supabase.from("repair_plan_parts").delete().eq("id", id)
  if (error) throw error
}
