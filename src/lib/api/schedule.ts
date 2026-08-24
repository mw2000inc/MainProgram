import { supabase } from "@/lib/supabase/client"
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

type ScheduleJobRow = {
  id: string
  job_type: ScheduleJobType
  technician: string
  technician_2: string | null
  customer_id: string | null
  order_no: string | null
  scheduled_date: string
  status: ScheduleJobStatus
  notes: string | null
  remarks: string | null
  created_at: string
  product_id: string | null
  quantity: number | null
  inventory_deducted_at: string | null
}

function fromRow(row: ScheduleJobRow): ScheduleJob {
  return {
    id: row.id,
    jobType: row.job_type,
    technician: row.technician,
    technician2: row.technician_2 ?? undefined,
    customerId: row.customer_id ?? undefined,
    orderNo: row.order_no ?? undefined,
    scheduledDate: row.scheduled_date,
    status: row.status,
    notes: row.notes ?? undefined,
    remarks: row.remarks ?? undefined,
    createdAt: row.created_at,
    productId: row.product_id ?? undefined,
    quantity: row.quantity ?? undefined,
    inventoryDeductedAt: row.inventory_deducted_at ?? undefined,
  }
}

function toRow(input: Partial<Omit<ScheduleJob, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.jobType !== undefined) row.job_type = input.jobType
  if (input.technician !== undefined) row.technician = input.technician
  if (input.technician2 !== undefined) row.technician_2 = input.technician2 || null
  if (input.customerId !== undefined) row.customer_id = input.customerId || null
  if (input.orderNo !== undefined) row.order_no = input.orderNo || null
  if (input.scheduledDate !== undefined) row.scheduled_date = input.scheduledDate
  if (input.status !== undefined) row.status = input.status
  if (input.notes !== undefined) row.notes = input.notes || null
  if (input.remarks !== undefined) row.remarks = input.remarks || null
  if (input.productId !== undefined) row.product_id = input.productId || null
  if (input.quantity !== undefined) row.quantity = input.quantity ?? null
  return row
}

export async function listScheduleJobs(): Promise<ScheduleJob[]> {
  const { data, error } = await supabase
    .from("schedule_jobs")
    .select("*")
    .order("scheduled_date", { ascending: true })
  if (error) throw error
  return (data as ScheduleJobRow[]).map(fromRow)
}

export async function createScheduleJob(input: Omit<ScheduleJob, "id" | "createdAt">): Promise<ScheduleJob> {
  const { data, error } = await supabase.from("schedule_jobs").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as ScheduleJobRow)
}

export async function updateScheduleJob(id: string, input: Partial<Omit<ScheduleJob, "id" | "createdAt">>): Promise<ScheduleJob> {
  const { data, error } = await supabase.from("schedule_jobs").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as ScheduleJobRow)
}

export async function deleteScheduleJob(id: string): Promise<void> {
  const { error } = await supabase.from("schedule_jobs").delete().eq("id", id)
  if (error) throw error
}
