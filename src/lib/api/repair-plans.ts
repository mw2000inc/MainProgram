import { supabase } from "@/lib/supabase/client"
import type { RepairPlan } from "@/lib/types"

type Row = {
  id: string
  issued_date: string
  account_name: string
  order_no: string
  status: string
  problem: string
  solution_status: string | null
  pre_d: string | null
  acc_d: string | null
  th: string
  part_no: string | null
  amt: number
  unit_in_out: string
  created_at: string
  dispatch_status: string | null
  notify_contact: string | null
  customer_notified_at: string | null
  customer_responded_at: string | null
}

function fromRow(row: Row): RepairPlan {
  return {
    id: row.id,
    issuedDate: row.issued_date,
    accountName: row.account_name,
    orderNo: row.order_no,
    status: row.status,
    problem: row.problem,
    solutionStatus: row.solution_status ?? undefined,
    preD: row.pre_d ?? undefined,
    accD: row.acc_d ?? undefined,
    th: row.th,
    partNo: row.part_no ?? undefined,
    amt: row.amt,
    unitInOut: row.unit_in_out,
    createdAt: row.created_at,
    dispatchStatus: (row.dispatch_status as RepairPlan["dispatchStatus"]) ?? undefined,
    notifyContact: row.notify_contact ?? undefined,
    customerNotifiedAt: row.customer_notified_at ?? undefined,
    customerRespondedAt: row.customer_responded_at ?? undefined,
  }
}

function toRow(input: Partial<Omit<RepairPlan, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.issuedDate !== undefined) row.issued_date = input.issuedDate
  if (input.accountName !== undefined) row.account_name = input.accountName
  if (input.orderNo !== undefined) row.order_no = input.orderNo
  if (input.status !== undefined) row.status = input.status
  if (input.problem !== undefined) row.problem = input.problem
  if (input.solutionStatus !== undefined) row.solution_status = input.solutionStatus || null
  if (input.preD !== undefined) row.pre_d = input.preD || null
  if (input.accD !== undefined) row.acc_d = input.accD || null
  if (input.th !== undefined) row.th = input.th
  if (input.partNo !== undefined) row.part_no = input.partNo || null
  if (input.amt !== undefined) row.amt = input.amt
  if (input.unitInOut !== undefined) row.unit_in_out = input.unitInOut
  if (input.dispatchStatus !== undefined) row.dispatch_status = input.dispatchStatus
  return row
}

export async function listRepairPlans(): Promise<RepairPlan[]> {
  const { data, error } = await supabase.from("repair_plans").select("*").order("issued_date", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createRepairPlan(input: Omit<RepairPlan, "id" | "createdAt">): Promise<RepairPlan> {
  const { data, error } = await supabase.from("repair_plans").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateRepairPlan(id: string, input: Partial<Omit<RepairPlan, "id" | "createdAt">>): Promise<RepairPlan> {
  const { data, error } = await supabase.from("repair_plans").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteRepairPlan(id: string): Promise<void> {
  const { error } = await supabase.from("repair_plans").delete().eq("id", id)
  if (error) throw error
}

export async function deleteRepairPlans(ids: string[]): Promise<void> {
  const { error } = await supabase.from("repair_plans").delete().in("id", ids)
  if (error) throw error
}
