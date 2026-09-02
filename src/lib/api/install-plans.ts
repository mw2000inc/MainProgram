import { supabase } from "@/lib/supabase/client"
import type { InstallPlan } from "@/lib/types"

type Row = {
  id: string
  name: string
  order_no: string
  input_date: string
  address: string
  status: string
  contact_number: string
  model: string
  unit_price: number
  cp_price: number
  delivery_installation_fee: number
  pre_installed_date: string | null
  installed_date: string | null
  note: string | null
  model_dp: string | null
  in_out: string
  created_at: string
  dispatch_status: string | null
  notify_contact: string | null
  notify_phone: string | null
  notify_email: string | null
  requested_date: string | null
  requested_time: string | null
  customer_notified_at: string | null
  customer_responded_at: string | null
}

function fromRow(row: Row): InstallPlan {
  return {
    id: row.id,
    name: row.name,
    orderNo: row.order_no,
    inputDate: row.input_date,
    address: row.address,
    status: row.status,
    contactNumber: row.contact_number,
    model: row.model,
    unitPrice: row.unit_price,
    cpPrice: row.cp_price,
    deliveryInstallationFee: row.delivery_installation_fee,
    preInstalledDate: row.pre_installed_date ?? undefined,
    installedDate: row.installed_date ?? undefined,
    note: row.note ?? undefined,
    modelDp: row.model_dp ?? undefined,
    inOut: row.in_out,
    createdAt: row.created_at,
    dispatchStatus: (row.dispatch_status as InstallPlan["dispatchStatus"]) ?? undefined,
    notifyContact: row.notify_contact ?? undefined,
    notifyPhone: row.notify_phone ?? undefined,
    notifyEmail: row.notify_email ?? undefined,
    requestedDate: row.requested_date ?? undefined,
    requestedTime: row.requested_time ?? undefined,
    customerNotifiedAt: row.customer_notified_at ?? undefined,
    customerRespondedAt: row.customer_responded_at ?? undefined,
  }
}

function toRow(input: Partial<Omit<InstallPlan, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.orderNo !== undefined) row.order_no = input.orderNo
  if (input.inputDate !== undefined) row.input_date = input.inputDate
  if (input.address !== undefined) row.address = input.address
  if (input.status !== undefined) row.status = input.status
  if (input.contactNumber !== undefined) row.contact_number = input.contactNumber
  if (input.model !== undefined) row.model = input.model
  if (input.unitPrice !== undefined) row.unit_price = input.unitPrice
  if (input.cpPrice !== undefined) row.cp_price = input.cpPrice
  if (input.deliveryInstallationFee !== undefined) row.delivery_installation_fee = input.deliveryInstallationFee
  if (input.preInstalledDate !== undefined) row.pre_installed_date = input.preInstalledDate || null
  if (input.installedDate !== undefined) row.installed_date = input.installedDate || null
  if (input.note !== undefined) row.note = input.note || null
  if (input.modelDp !== undefined) row.model_dp = input.modelDp || null
  if (input.inOut !== undefined) row.in_out = input.inOut
  if (input.dispatchStatus !== undefined) row.dispatch_status = input.dispatchStatus
  return row
}

export async function listInstallPlans(): Promise<InstallPlan[]> {
  const { data, error } = await supabase.from("install_plans").select("*").order("input_date", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createInstallPlan(input: Omit<InstallPlan, "id" | "createdAt">): Promise<InstallPlan> {
  const { data, error } = await supabase.from("install_plans").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateInstallPlan(id: string, input: Partial<Omit<InstallPlan, "id" | "createdAt">>): Promise<InstallPlan> {
  const { data, error } = await supabase.from("install_plans").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteInstallPlan(id: string): Promise<void> {
  const { error } = await supabase.from("install_plans").delete().eq("id", id)
  if (error) throw error
}

export async function deleteInstallPlans(ids: string[]): Promise<void> {
  const { error } = await supabase.from("install_plans").delete().in("id", ids)
  if (error) throw error
}
