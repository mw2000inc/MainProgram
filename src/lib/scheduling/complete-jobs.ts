import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface CompleteJobsResult {
  completed: number
  filterChangeVisits: number
  installs: number
  repairs: number
  // Pending inventory movements queued for unlinked Filter Change jobs'
  // own filter codes (linked records queue through their own triggers).
  queuedFromJobs: number
}

// Batch "Mark as Completed" for schedule jobs (the Schedule full-screen
// view). For each still-pending job:
//   1. the job itself -> 'completed' (only from 'pending' — never touches a
//      'pending_approval' or already-finished job)
//   2. the Filter Change visit / install / repair it was created for (linked
//      through schedule_job_id) -> Completed, with its empty Acc D /
//      Installed Date filled with `today`. The database's inventory-queue
//      triggers react to that exactly as they do to a single completion:
//      a visit's filters and an install's unit are queued as pending stock
//      movements. A date someone already entered is kept. (Repairs queue
//      their parts when the parts are recorded, so nothing extra there.)
//   3. a Filter Change job linked to no visit but carrying its own filter
//      codes (set from the Auto-suggest modal) -> those filters queued as
//      pending movements on the job, one per code (quantity = times listed),
//      matched to products by SKU — skipped when the job already has
//      movements, so it's never queued twice.
// `today` is the admin's local date, sent by the client.
export async function completeScheduleJobs(
  admin: SupabaseClient,
  jobIds: string[],
  today: string,
  // Recorded as who created any movements queued here.
  actorId: string
): Promise<CompleteJobsResult> {
  const result: CompleteJobsResult = { completed: 0, filterChangeVisits: 0, installs: 0, repairs: 0, queuedFromJobs: 0 }
  if (jobIds.length === 0) return result

  const { data: updated, error } = await admin
    .from("schedule_jobs")
    .update({ status: "completed" })
    .in("id", jobIds)
    .eq("status", "pending")
    .select("id, job_type, order_no, filter_codes")
  if (error) throw error
  const done = (updated ?? []) as { id: string; job_type: string; order_no: string | null; filter_codes: string | null }[]
  result.completed = done.length
  const ids = done.map((j) => j.id)
  if (ids.length === 0) return result

  const completeLinked = async (table: string, dateColumn: string) => {
    const { data: rows } = await admin.from(table).select(`id, ${dateColumn}, status`).in("schedule_job_id", ids)
    const targets = ((rows ?? []) as unknown as Record<string, string | null>[]).filter((r) => r.status !== "Cancelled")
    for (const r of targets) {
      await admin
        .from(table)
        .update({ status: "Completed", ...(r[dateColumn] ? {} : { [dateColumn]: today }) })
        .eq("id", r.id as string)
    }
    return targets.length
  }
  result.filterChangeVisits = await completeLinked("filter_change_plans", "acc_d")
  result.installs = await completeLinked("install_plans", "installed_date")
  result.repairs = await completeLinked("repair_plans", "acc_d")

  const { data: linkedVisits } = await admin.from("filter_change_plans").select("schedule_job_id").in("schedule_job_id", ids)
  const hasVisit = new Set((linkedVisits ?? []).map((r: { schedule_job_id: string }) => r.schedule_job_id))
  const unlinkedWithFilters = done.filter((j) => j.job_type === "filter_change" && !hasVisit.has(j.id) && (j.filter_codes ?? "").trim())
  if (unlinkedWithFilters.length > 0) {
    const { data: products } = await admin.from("products").select("id, sku, date_added").order("date_added")
    const productBySku = new Map<string, string>()
    for (const p of (products ?? []) as { id: string; sku: string }[]) if (!productBySku.has(p.sku.trim())) productBySku.set(p.sku.trim(), p.id)
    for (const job of unlinkedWithFilters) {
      const { data: existing } = await admin.from("stock_movements").select("id").eq("schedule_job_id", job.id).limit(1)
      if (existing && existing.length > 0) continue
      const counts = new Map<string, number>()
      for (const code of (job.filter_codes ?? "").split(",").map((c) => c.trim()).filter(Boolean)) counts.set(code, (counts.get(code) ?? 0) + 1)
      const rows = [...counts].flatMap(([code, qty]) => {
        const productId = productBySku.get(code)
        return productId
          ? [{
              date: today,
              product_id: productId,
              quantity_added: 0,
              quantity_removed: qty,
              reason: "Filter Change",
              user_id: actorId,
              reference_number: job.order_no || job.id,
              schedule_job_id: job.id,
              status: "pending",
            }]
          : []
      })
      if (rows.length === 0) continue
      const { error: insertError } = await admin.from("stock_movements").insert(rows)
      if (!insertError) result.queuedFromJobs += rows.length
    }
  }
  return result
}
