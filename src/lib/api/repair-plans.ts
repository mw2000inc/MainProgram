import { supabase } from "@/lib/supabase/client"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import type { RepairPlan } from "@/lib/types"

type Row = {
  id: string
  issued_date: string
  account_name: string
  order_no: string
  status: string
  address: string | null
  problem: string
  solution_status: string | null
  pre_d: string | null
  acc_d: string | null
  th: string
  part_no: string | null
  amt: number
  unit_in_out: string
  contact_number: string | null
  in_out: string | null
  model: string | null
  unit_price: number | null
  cp_price: number | null
  delivery_installation_fee: number | null
  payment_mode: string | null
  receipt_no: string | null
  pre_installed_date: string | null
  installed_date: string | null
  sales_person: string | null
  via: string | null
  note: string | null
  created_at: string
  dispatch_status: string | null
  notify_contact: string | null
  notify_phone: string | null
  notify_email: string | null
  requested_date: string | null
  requested_time: string | null
  schedule_job_id: string | null
  customer_notified_at: string | null
  customer_responded_at: string | null
  rejected_by: string | null
  rejected_at: string | null
  rejection_reason: string | null
  reschedule_reason: string | null
}

function fromRow(row: Row): RepairPlan {
  return {
    id: row.id,
    issuedDate: row.issued_date,
    accountName: row.account_name,
    orderNo: row.order_no,
    status: row.status,
    address: row.address ?? undefined,
    problem: row.problem,
    solutionStatus: row.solution_status ?? undefined,
    preD: row.pre_d ?? undefined,
    accD: row.acc_d ?? undefined,
    th: row.th,
    partNo: row.part_no ?? undefined,
    amt: row.amt,
    unitInOut: row.unit_in_out,
    contactNumber: row.contact_number ?? undefined,
    inOut: row.in_out ?? undefined,
    model: row.model ?? undefined,
    unitPrice: row.unit_price ?? undefined,
    cpPrice: row.cp_price ?? undefined,
    deliveryInstallationFee: row.delivery_installation_fee ?? undefined,
    paymentMode: row.payment_mode ?? undefined,
    receiptNo: row.receipt_no ?? undefined,
    preInstalledDate: row.pre_installed_date ?? undefined,
    installedDate: row.installed_date ?? undefined,
    salesPerson: row.sales_person ?? undefined,
    via: row.via ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    dispatchStatus: (row.dispatch_status as RepairPlan["dispatchStatus"]) ?? undefined,
    notifyContact: row.notify_contact ?? undefined,
    notifyPhone: row.notify_phone ?? undefined,
    notifyEmail: row.notify_email ?? undefined,
    requestedDate: row.requested_date ?? undefined,
    requestedTime: row.requested_time ?? undefined,
    scheduleJobId: row.schedule_job_id ?? undefined,
    customerNotifiedAt: row.customer_notified_at ?? undefined,
    customerRespondedAt: row.customer_responded_at ?? undefined,
    rejectedBy: row.rejected_by ?? undefined,
    rejectedAt: row.rejected_at ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    rescheduleReason: row.reschedule_reason ?? undefined,
  }
}

function toRow(input: Partial<Omit<RepairPlan, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.issuedDate !== undefined) row.issued_date = input.issuedDate
  if (input.accountName !== undefined) row.account_name = input.accountName
  if (input.orderNo !== undefined) row.order_no = input.orderNo
  if (input.status !== undefined) row.status = input.status
  if (input.address !== undefined) row.address = input.address || null
  if (input.problem !== undefined) row.problem = input.problem
  if (input.solutionStatus !== undefined) row.solution_status = input.solutionStatus || null
  if (input.preD !== undefined) row.pre_d = input.preD || null
  if (input.accD !== undefined) row.acc_d = input.accD || null
  if (input.th !== undefined) row.th = input.th
  if (input.partNo !== undefined) row.part_no = input.partNo || null
  if (input.amt !== undefined) row.amt = input.amt
  if (input.unitInOut !== undefined) row.unit_in_out = input.unitInOut
  if (input.contactNumber !== undefined) row.contact_number = input.contactNumber || null
  if (input.inOut !== undefined) row.in_out = input.inOut || null
  if (input.model !== undefined) row.model = input.model || null
  if (input.unitPrice !== undefined) row.unit_price = input.unitPrice
  if (input.cpPrice !== undefined) row.cp_price = input.cpPrice
  if (input.deliveryInstallationFee !== undefined) row.delivery_installation_fee = input.deliveryInstallationFee
  if (input.paymentMode !== undefined) row.payment_mode = input.paymentMode || null
  if (input.receiptNo !== undefined) row.receipt_no = input.receiptNo || null
  if (input.preInstalledDate !== undefined) row.pre_installed_date = input.preInstalledDate || null
  if (input.installedDate !== undefined) row.installed_date = input.installedDate || null
  if (input.salesPerson !== undefined) row.sales_person = input.salesPerson || null
  if (input.via !== undefined) row.via = input.via || null
  if (input.note !== undefined) row.note = input.note || null
  if (input.dispatchStatus !== undefined) row.dispatch_status = input.dispatchStatus
  return row
}

// Paginates via fetchAllRows rather than a single un-ranged select() — see
// that helper's own comment for why: PostgREST silently caps an un-ranged
// select() at 1000 rows on this project, already confirmed to have
// actually truncated filter_change_plans in production once it grew past
// that. repair_plans hasn't hit that size yet, but nothing stops it from
// eventually doing so the same way, and a silently-truncated list here
// would show up as an undercounted Repair total on the Pending Dispatch
// Approval / Daily Report Approvals Approval Summary — the same failure
// mode, just not yet triggered.
export async function listRepairPlans(): Promise<RepairPlan[]> {
  const data = await fetchAllRows<Row>((from, to) =>
    supabase.from("repair_plans").select("*").order("issued_date", { ascending: true }).range(from, to)
  )
  return data.map(fromRow)
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
