import { supabase } from "@/lib/supabase/client"
import type { ScheduleJobFilterItem } from "@/lib/types"

type Row = {
  id: string
  schedule_job_id: string
  product_id: string
  quantity: number
  created_at: string
}

function fromRow(row: Row): ScheduleJobFilterItem {
  return {
    id: row.id,
    scheduleJobId: row.schedule_job_id,
    productId: row.product_id,
    quantity: row.quantity,
    createdAt: row.created_at,
  }
}

export async function listScheduleJobFilterItems(scheduleJobId: string): Promise<ScheduleJobFilterItem[]> {
  const { data, error } = await supabase
    .from("schedule_job_filter_items")
    .select("*")
    .eq("schedule_job_id", scheduleJobId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

// One insert call for the whole list a technician/admin records at job-
// completion time — each row's own AFTER INSERT trigger (see the
// ct_filter_change_collection_inventory_link migration) finds-or-creates
// that job's Filter Change/Collection records and inserts its own pending
// stock movement, so nothing further is needed from the client once this
// resolves.
export async function createScheduleJobFilterItems(
  scheduleJobId: string,
  items: { productId: string; quantity: number }[]
): Promise<ScheduleJobFilterItem[]> {
  if (items.length === 0) return []
  const { data, error } = await supabase
    .from("schedule_job_filter_items")
    .insert(items.map((i) => ({ schedule_job_id: scheduleJobId, product_id: i.productId, quantity: i.quantity })))
    .select()
  if (error) throw error
  return (data as Row[]).map(fromRow)
}
