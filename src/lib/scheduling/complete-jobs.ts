import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface CompleteJobsResult {
  completed: number
  filterChangeVisits: number
  installs: number
  repairs: number
  collections: number
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
//   2b. a Collection job's linked collection -> collected (status Collected,
//      collected = true, Collected by = this admin, Collected at = now, Acc D
//      = today — each only if still empty, the same rule the All Collection
//      view's own Collected toggle follows). Only for Collection jobs: a
//      payment linked to a filter change / repair visit isn't proof the money
//      was received just because the visit was done, so it's left as is.
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
  const result: CompleteJobsResult = { completed: 0, filterChangeVisits: 0, installs: 0, repairs: 0, collections: 0, queuedFromJobs: 0 }
  if (jobIds.length === 0) return result

  const { data: updated, error } = await admin
    .from("schedule_jobs")
    // updated_by: this runs with the service-role client (no auth.uid()), so
    // the admin is recorded explicitly — otherwise the jobs show no "updated
    // by" at all and a batch can't be traced back to who ran it.
    .update({ status: "completed", updated_by: actorId })
    .in("id", jobIds)
    .eq("status", "pending")
    .select("id, job_type, order_no, filter_codes, scheduled_date")
  if (error) throw error
  const done = (updated ?? []) as { id: string; job_type: string; order_no: string | null; filter_codes: string | null; scheduled_date: string | null }[]
  // A record completed here is dated its job's own day (the Daily Report day
  // it's on), not the day the batch ran.
  const jobDay = new Map(done.map((j) => [j.id, j.scheduled_date || today]))
  result.completed = done.length
  const ids = done.map((j) => j.id)
  if (ids.length === 0) return result

  // Completing the jobs above already completed their records in the
  // database (sync_job_completion_to_records, 20261027000000 / 20261116000000),
  // so only a record still not done is saved here — before, every record was
  // saved again one at a time, each firing the inventory/date triggers again,
  // which made a big batch take a long time. The few left are saved together.
  const inParallel = async <T,>(items: T[], run: (item: T) => PromiseLike<unknown>) => {
    for (let i = 0; i < items.length; i += 10) await Promise.all(items.slice(i, i + 10).map(run))
  }
  const completeLinked = async (table: string, dateColumn: string) => {
    const { data: rows } = await admin.from(table).select(`id, ${dateColumn}, status, schedule_job_id`).in("schedule_job_id", ids)
    const linked = ((rows ?? []) as unknown as Record<string, string | null>[]).filter((r) => r.status !== "Cancelled")
    const notDone = linked.filter((r) => r.status !== "Completed")
    await inParallel(notDone, (r) =>
      admin
        .from(table)
        .update({ status: "Completed", updated_by: actorId, ...(r[dateColumn] ? {} : { [dateColumn]: jobDay.get(r.schedule_job_id as string) ?? today }) })
        .eq("id", r.id as string)
    )
    return linked.length
  }
  const [fcCount, installCount, repairCount] = await Promise.all([
    completeLinked("filter_change_plans", "acc_d"),
    completeLinked("install_plans", "installed_date"),
    completeLinked("repair_plans", "acc_d"),
  ])
  result.filterChangeVisits = fcCount
  result.installs = installCount
  result.repairs = repairCount

  const collectionJobIds = done.filter((j) => j.job_type === "collection").map((j) => j.id)
  if (collectionJobIds.length > 0) {
    const { data: rows } = await admin
      .from("collections")
      .select("id, status, collected, collected_by, collected_at, acc_d, schedule_job_id")
      .in("schedule_job_id", collectionJobIds)
    const nowIso = new Date().toISOString()
    type Col = { id: string; status: string; collected: boolean | null; collected_by: string | null; collected_at: string | null; acc_d: string | null; schedule_job_id: string }
    const live = ((rows ?? []) as Col[]).filter((r) => r.status !== "Cancelled")
    result.collections = live.length
    // Already collected by the database on the job's completion: left as is.
    await inParallel(
      live.filter((r) => !(r.status === "Collected" && r.collected)),
      (r) =>
        admin
          .from("collections")
          .update({
            status: "Collected",
            updated_by: actorId,
            collected: true,
            collected_by: r.collected_by ?? actorId,
            collected_at: r.collected_at ?? nowIso,
            ...(r.acc_d ? {} : { acc_d: jobDay.get(r.schedule_job_id) ?? today }),
          })
          .eq("id", r.id)
    )
  }

  const { data: linkedVisits } = await admin.from("filter_change_plans").select("schedule_job_id").in("schedule_job_id", ids)
  const hasVisit = new Set((linkedVisits ?? []).map((r: { schedule_job_id: string }) => r.schedule_job_id))
  const unlinkedWithFilters = done.filter((j) => j.job_type === "filter_change" && !hasVisit.has(j.id) && (j.filter_codes ?? "").trim())
  if (unlinkedWithFilters.length > 0) {
    const { data: products } = await admin.from("products").select("id, sku, date_added").order("date_added")
    const productBySku = new Map<string, string>()
    for (const p of (products ?? []) as { id: string; sku: string }[]) if (!productBySku.has(p.sku.trim())) productBySku.set(p.sku.trim(), p.id)
    // One query for which of these jobs already have movements (not one per job).
    const { data: queuedRows } = await admin.from("stock_movements").select("schedule_job_id").in("schedule_job_id", unlinkedWithFilters.map((j) => j.id))
    const alreadyQueued = new Set(((queuedRows ?? []) as { schedule_job_id: string }[]).map((m) => m.schedule_job_id))
    for (const job of unlinkedWithFilters) {
      if (alreadyQueued.has(job.id)) continue
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
