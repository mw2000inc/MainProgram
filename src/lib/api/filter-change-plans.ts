import { supabase } from "@/lib/supabase/client"
import type { FilterChangePlan } from "@/lib/types"

type Row = {
  id: string
  order_number: string
  member_account: string
  filter_type: string
  plan_date: string
  status: string
  contact_number: string
  address: string
  s_c: string
  product_no: string
  pre_d: string | null
  acc_d: string | null
  serviceman: string
  note: string | null
  created_at: string
}

function fromRow(row: Row): FilterChangePlan {
  return {
    id: row.id,
    orderNumber: row.order_number,
    memberAccount: row.member_account,
    filterType: row.filter_type,
    planDate: row.plan_date,
    status: row.status,
    contactNumber: row.contact_number,
    address: row.address,
    sc: row.s_c,
    productNo: row.product_no,
    preD: row.pre_d ?? undefined,
    accD: row.acc_d ?? undefined,
    serviceman: row.serviceman,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }
}

function toRow(input: Partial<Omit<FilterChangePlan, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.orderNumber !== undefined) row.order_number = input.orderNumber
  if (input.memberAccount !== undefined) row.member_account = input.memberAccount
  if (input.filterType !== undefined) row.filter_type = input.filterType
  if (input.planDate !== undefined) row.plan_date = input.planDate
  if (input.status !== undefined) row.status = input.status
  if (input.contactNumber !== undefined) row.contact_number = input.contactNumber
  if (input.address !== undefined) row.address = input.address
  if (input.sc !== undefined) row.s_c = input.sc
  if (input.productNo !== undefined) row.product_no = input.productNo
  if (input.preD !== undefined) row.pre_d = input.preD || null
  if (input.accD !== undefined) row.acc_d = input.accD || null
  if (input.serviceman !== undefined) row.serviceman = input.serviceman
  if (input.note !== undefined) row.note = input.note || null
  return row
}

export async function listFilterChangePlans(): Promise<FilterChangePlan[]> {
  const { data, error } = await supabase.from("filter_change_plans").select("*").order("plan_date", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createFilterChangePlan(input: Omit<FilterChangePlan, "id" | "createdAt">): Promise<FilterChangePlan> {
  const { data, error } = await supabase.from("filter_change_plans").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateFilterChangePlan(id: string, input: Partial<Omit<FilterChangePlan, "id" | "createdAt">>): Promise<FilterChangePlan> {
  const { data, error } = await supabase.from("filter_change_plans").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteFilterChangePlan(id: string): Promise<void> {
  const { error } = await supabase.from("filter_change_plans").delete().eq("id", id)
  if (error) throw error
}

export async function deleteFilterChangePlans(ids: string[]): Promise<void> {
  const { error } = await supabase.from("filter_change_plans").delete().in("id", ids)
  if (error) throw error
}
