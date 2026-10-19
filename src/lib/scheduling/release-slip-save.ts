import type { SupabaseClient } from "@supabase/supabase-js"

// "Save to Daily Report" on the Release Slip (server side, admin client).
// Each slip row becomes a COMPLETED visit on the slip's date for the slip's
// technician, and the items typed on it are queued in Inventory (pending,
// for an admin to approve):
//
// 1. The job: the row's own scheduled job; for a row added on the slip, that
//    technician's job for the same order and type on that date if there is
//    one, else a new job ('manual'). A new job is linked to the nearest open
//    record of that order — or a record is created — by
//    ensure_schedule_job_module_record (20261020000000), so a visit that was
//    already planned is never duplicated.
// 2. Completed through its record, dated the slip's date: Filter Change /
//    Repair → Completed + Acc D, Installation → Completed + Installed Date,
//    Collection → Collected. The database then completes the job
//    (sync_record_completion_to_job) and queues what each module queues on
//    completion (its filters, the install's model…). A job with no record is
//    completed directly.
// 3. Items: each OUT / IN item on the row, beyond what is already queued for
//    the job or its record (same product — or same label when unmapped — and
//    direction), is added as a pending movement dated the slip's date.
//
// A technician saves only their own slip; checked by the API route.

export type SlipSaveJobType = "filter_change" | "repair" | "installation" | "collection"
export type SlipSaveItem = { sku: string; qtyOut: number; qtyIn: number }
export type SlipSaveRow = {
  jobId?: string
  orderNo: string
  accountName: string
  jobType: SlipSaveJobType
  items: SlipSaveItem[]
}
export type SlipSaveResult = {
  created: number
  completed: number
  alreadyCompleted: number
  movements: number
  skipped: { orderNo: string; reason: string }[]
}

const TABLE: Record<SlipSaveJobType, "filter_change_plans" | "repair_plans" | "install_plans" | "collections"> = {
  filter_change: "filter_change_plans",
  repair: "repair_plans",
  installation: "install_plans",
  collection: "collections",
}
const RECORD_LINK: Record<SlipSaveJobType, "filter_change_plan_id" | "repair_plan_id" | "install_plan_id" | null> = {
  filter_change: "filter_change_plan_id",
  repair: "repair_plan_id",
  installation: "install_plan_id",
  collection: null,
}
const REASON: Record<SlipSaveJobType, string> = {
  filter_change: "Filter Change",
  repair: "Repair",
  installation: "Installation",
  collection: "Adjustment",
}

type Job = { id: string; job_type: string; status: string; scheduled_date: string; technician_user_id: string | null; technician_2_user_id: string | null; order_no: string | null }

export async function saveReleaseSlip(
  db: SupabaseClient,
  input: { date: string; technicianUserId: string; actorUserId: string; rows: SlipSaveRow[] }
): Promise<SlipSaveResult> {
  const result: SlipSaveResult = { created: 0, completed: 0, alreadyCompleted: 0, movements: 0, skipped: [] }
  const { date, technicianUserId, actorUserId } = input

  const { data: tech } = await db.from("profiles").select("id, name").eq("id", technicianUserId).maybeSingle()
  if (!tech) throw new Error("Technician not found")

  // Products by SKU (the earliest added, like every other queue).
  const { data: products } = await db.from("products").select("id, sku, date_added").order("date_added", { ascending: true })
  const productBySku = new Map<string, string>()
  for (const p of (products ?? []) as { id: string; sku: string | null }[]) {
    const sku = (p.sku ?? "").trim()
    if (sku && !productBySku.has(sku)) productBySku.set(sku, p.id)
  }

  for (const row of input.rows) {
    const order = row.orderNo.trim()
    try {
      // ---- 1. the job
      let job: Job | null = null
      if (row.jobId) {
        const { data } = await db.from("schedule_jobs").select("id, job_type, status, scheduled_date, technician_user_id, technician_2_user_id, order_no").eq("id", row.jobId).maybeSingle()
        job = data as Job | null
        if (!job) {
          result.skipped.push({ orderNo: order, reason: "job not found" })
          continue
        }
        if (job.technician_user_id !== technicianUserId && job.technician_2_user_id !== technicianUserId) {
          result.skipped.push({ orderNo: order, reason: "not this technician's job" })
          continue
        }
      } else {
        if (!order) {
          result.skipped.push({ orderNo: "(blank)", reason: "no Order No." })
          continue
        }
        const { data: existing } = await db
          .from("schedule_jobs")
          .select("id, job_type, status, scheduled_date, technician_user_id, technician_2_user_id, order_no")
          .eq("order_no", order)
          .eq("job_type", row.jobType)
          .eq("scheduled_date", date)
          .in("status", ["pending", "completed"])
          .or(`technician_user_id.eq.${technicianUserId},technician_2_user_id.eq.${technicianUserId}`)
          .limit(1)
        job = ((existing ?? [])[0] as Job | undefined) ?? null
        if (!job) {
          const { data: sale } = await db.from("sale_list_entries").select("customer_id").eq("order_number", order).not("customer_id", "is", null).limit(1)
          const filterCodes =
            row.jobType === "filter_change"
              ? row.items.flatMap((i) => Array.from({ length: Math.max(0, Math.floor(i.qtyOut)) }, () => i.sku.trim())).filter(Boolean).join(", ")
              : ""
          const { data: inserted, error } = await db
            .from("schedule_jobs")
            .insert({
              job_type: row.jobType,
              order_no: order,
              customer_id: (sale ?? [])[0]?.customer_id ?? null,
              scheduled_date: date,
              technician: tech.name ?? "",
              technician_user_id: technicianUserId,
              vehicle: "",
              status: "pending",
              source: "manual",
              notes: row.accountName.trim() || null,
              filter_codes: filterCodes,
            })
            .select("id, job_type, status, scheduled_date, technician_user_id, technician_2_user_id, order_no")
            .single()
          if (error) throw error
          job = inserted as Job
          result.created += 1
          // Link (or create) its record now; the commit-time trigger does the same.
          await db.rpc("ensure_schedule_job_module_record", { p_job_id: job.id }).then(
            () => undefined,
            () => undefined
          )
        }
      }
      if (job.status === "cancelled" || job.status === "pending_approval") {
        result.skipped.push({ orderNo: order, reason: job.status === "cancelled" ? "job cancelled" : "draft not approved yet" })
        continue
      }
      const jobType = (job.job_type as SlipSaveJobType) in TABLE ? (job.job_type as SlipSaveJobType) : row.jobType

      // ---- 2. complete it through its record, dated the slip's date
      const table = TABLE[jobType]
      const { data: rec } = await db.from(table).select("*").eq("schedule_job_id", job.id).maybeSingle()
      const record = rec as Record<string, unknown> | null
      if (job.status === "completed") {
        result.alreadyCompleted += 1
      } else {
        if (record) {
          const accountPatch: Record<string, unknown> = {}
          const name = row.accountName.trim()
          const accountField = jobType === "filter_change" ? "member_account" : jobType === "installation" ? "name" : "account_name"
          if (name && !String(record[accountField] ?? "").trim()) accountPatch[accountField] = name
          const patch =
            jobType === "collection"
              ? { status: "Collected", collected: true, collected_by: actorUserId, collected_at: new Date().toISOString(), acc_d: record.acc_d ?? date }
              : jobType === "installation"
                ? { status: "Completed", installed_date: record.installed_date ?? date }
                : jobType === "filter_change"
                  ? // A Filter Change is dated its Pre D (20261118000000).
                    { status: "Completed", acc_d: record.pre_d ?? record.acc_d ?? date }
                  : { status: "Completed", acc_d: record.acc_d ?? date }
          const { error } = await db.from(table).update({ ...accountPatch, ...patch }).eq("id", record.id as string)
          if (error) throw error
        }
        // No record, or the record was already done: complete the job itself.
        await db.from("schedule_jobs").update({ status: "completed" }).eq("id", job.id).eq("status", "pending")
        result.completed += 1
      }

      // ---- 2b. Repair: the parts on the slip become the record's Part No, so
      // the admin sees them on the Repair side (Part No, PART OUT badges). The
      // Part No queue (queue_repair_part_no_inventory, 20261113000000) then
      // queues them — counted below as already queued, so nothing doubles.
      // The repair's own replacement unit (its 'Repair Unit' line) isn't a
      // part. A slip with no OUT parts leaves Part No as it is.
      if (record && jobType === "repair") {
        const { data: units } = await db
          .from("stock_movements")
          .select("product_id, item_label, quantity_removed")
          .eq("repair_plan_id", record.id as string)
          .eq("reason", "Repair Unit")
          .neq("status", "rejected")
        const unitLeft = new Map<string, number>()
        for (const u of (units ?? []) as { product_id: string | null; item_label: string | null; quantity_removed: number }[]) {
          const code = (u.item_label ?? "").split(" / ")[0].trim()
          const key = u.product_id ?? `label:${code}`
          unitLeft.set(key, (unitLeft.get(key) ?? 0) + (u.quantity_removed || 0))
        }
        const codes: string[] = []
        for (const item of row.items) {
          const sku = item.sku.trim()
          let qty = Math.max(0, Math.floor(item.qtyOut || 0))
          if (!sku || !qty) continue
          const key = productBySku.get(sku) ?? `label:${sku}`
          const unit = unitLeft.get(key) ?? 0
          const skip = Math.min(unit, qty)
          unitLeft.set(key, unit - skip)
          qty -= skip
          for (let i = 0; i < qty; i++) codes.push(sku)
        }
        const current = String(record.part_no ?? "")
          .split(/[,;/\n]+/)
          .map((c) => c.trim())
          .filter(Boolean)
        if (codes.length && [...codes].sort().join(",") !== [...current].sort().join(",")) {
          const { error } = await db.from("repair_plans").update({ part_no: codes.join(", ") }).eq("id", record.id as string)
          if (error) throw error
        }
      }

      // ---- 3. items not queued yet
      const link = RECORD_LINK[jobType]
      const ors = [`schedule_job_id.eq.${job.id}`]
      if (record && link) ors.push(`${link}.eq.${record.id as string}`)
      if (record && jobType === "repair") {
        const { data: parts } = await db.from("repair_plan_parts").select("id").eq("repair_plan_id", record.id as string)
        const partIds = ((parts ?? []) as { id: string }[]).map((p) => p.id)
        if (partIds.length) ors.push(`repair_plan_part_id.in.(${partIds.join(",")})`)
      }
      const { data: existingMoves } = await db.from("stock_movements").select("product_id, item_label, quantity_added, quantity_removed, status").or(ors.join(",")).neq("status", "rejected")
      const queued = new Map<string, { out: number; in: number }>()
      for (const m of (existingMoves ?? []) as { product_id: string | null; item_label: string | null; quantity_added: number; quantity_removed: number }[]) {
        const key = m.product_id ?? `label:${(m.item_label ?? "").trim()}`
        const q = queued.get(key) ?? { out: 0, in: 0 }
        q.out += m.quantity_removed || 0
        q.in += m.quantity_added || 0
        queued.set(key, q)
      }
      const wanted = new Map<string, { sku: string; productId: string | null; out: number; in: number }>()
      for (const item of row.items) {
        const sku = item.sku.trim()
        if (!sku) continue
        const productId = productBySku.get(sku) ?? null
        const key = productId ?? `label:${sku}`
        const w = wanted.get(key) ?? { sku, productId, out: 0, in: 0 }
        w.out += Math.max(0, Math.floor(item.qtyOut || 0))
        w.in += Math.max(0, Math.floor(item.qtyIn || 0))
        wanted.set(key, w)
      }
      const inserts: Record<string, unknown>[] = []
      for (const [key, w] of wanted) {
        const have = queued.get(key) ?? { out: 0, in: 0 }
        const out = w.out - have.out
        const back = w.in - have.in
        for (const [removed, added] of [
          [out > 0 ? out : 0, 0],
          [0, back > 0 ? back : 0],
        ] as const) {
          if (!removed && !added) continue
          inserts.push({
            date,
            product_id: w.productId,
            item_label: w.productId ? null : w.sku,
            quantity_removed: removed,
            quantity_added: added,
            // A part brought back on a repair is a Return.
            reason: jobType === "repair" && added ? "Return" : REASON[jobType],
            user_id: actorUserId,
            reference_number: order || job.order_no || job.id,
            schedule_job_id: job.id,
            // Not linked to the repair record itself: the Part No queue clears
            // every pending 'Repair' line linked to the repair whenever it's
            // edited, which would silently drop these. The job link is enough
            // for the Release Slip and the Daily Report.
            ...(record && link && jobType !== "repair" ? { [link]: record.id } : {}),
            status: "pending",
          })
        }
      }
      if (inserts.length) {
        const { error } = await db.from("stock_movements").insert(inserts)
        if (error) throw error
        result.movements += inserts.length
      }
    } catch (e) {
      result.skipped.push({ orderNo: order || "(blank)", reason: e instanceof Error ? e.message : "failed" })
    }
  }
  return result
}
