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
  customer_id: string | null
  schedule_job_id: string | null
  source: string
  sale_list_entry_id: string | null
  occurrence_index: number | null
  dispatch_status: string | null
  notify_contact: string | null
  notify_phone: string | null
  notify_email: string | null
  requested_date: string | null
  requested_time: string | null
  customer_notified_at: string | null
  customer_responded_at: string | null
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
    customerId: row.customer_id ?? undefined,
    scheduleJobId: row.schedule_job_id ?? undefined,
    source: (row.source as FilterChangePlan["source"]) ?? "manual",
    saleListEntryId: row.sale_list_entry_id ?? undefined,
    occurrenceIndex: row.occurrence_index ?? undefined,
    dispatchStatus: (row.dispatch_status as FilterChangePlan["dispatchStatus"]) ?? undefined,
    notifyContact: row.notify_contact ?? undefined,
    notifyPhone: row.notify_phone ?? undefined,
    notifyEmail: row.notify_email ?? undefined,
    requestedDate: row.requested_date ?? undefined,
    requestedTime: row.requested_time ?? undefined,
    customerNotifiedAt: row.customer_notified_at ?? undefined,
    customerRespondedAt: row.customer_responded_at ?? undefined,
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
  if (input.dispatchStatus !== undefined) row.dispatch_status = input.dispatchStatus
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
