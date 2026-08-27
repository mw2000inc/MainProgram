import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Retired from vercel.json's cron schedule (see the ct_filter_change_
// collection_inventory_link migration) — completing a job now records its
// required filters via schedule_job_filter_items, which inserts its own
// pending stock movement per item, gated on an admin's explicit approval
// rather than deducting immediately and unconditionally the way this route
// always has. Left in place, callable manually, purely for the older single-
// product-per-job path (schedule_jobs.product_id/quantity, still settable in
// the full Schedule form) — existing historical stock_movements rows it
// already created are untouched by that migration.
//
// Runs on a schedule (see vercel.json) — for every "filter_change" schedule
// job that's been marked completed (by an admin/technician — this never
// fires off the scheduled date alone, since a job can be rescheduled or
// never actually happen) with a product + quantity set, and hasn't already
// been deducted, inserts a stock_movements row and marks the job deducted.
//
// Policy, confirmed before writing this:
// - Idempotency: inventory_deducted_at on the job is the guard — once set, a
//   job is never deducted again. Belt-and-suspenders: also skip if a
//   stock_movements row already references this job (covers the case where
//   a prior run inserted the movement but failed before marking the job).
// - Insufficient stock: deducts anyway, same as every other deduction path
//   in this app (the existing apply_stock_movement trigger has no blocking
//   logic either) — negative stock surfaces via the existing low-stock/
//   out-of-stock notification trigger, not a silent failure.
// - No human actor: stock_movements.user_id is left null for these rows
//   (nullable as of the migration that added this feature).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: jobs, error: jobsError } = await admin
    .from("schedule_jobs")
    .select("id, order_no, product_id, quantity")
    .eq("job_type", "filter_change")
    .eq("status", "completed")
    .is("inventory_deducted_at", null)
    .not("product_id", "is", null)
    .not("quantity", "is", null)
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 })

  const today = new Date().toISOString().slice(0, 10)
  let deducted = 0
  let alreadyHadMovement = 0
  const errors: string[] = []

  for (const job of jobs ?? []) {
    if (!job.product_id || !job.quantity || job.quantity <= 0) continue

    const { data: existingMovement, error: existingError } = await admin
      .from("stock_movements")
      .select("id")
      .eq("schedule_job_id", job.id)
      .maybeSingle()
    if (existingError) {
      errors.push(`${job.id}: ${existingError.message}`)
      continue
    }
    if (existingMovement) {
      // A prior run inserted the movement but didn't get to mark the job —
      // finish that instead of inserting a second movement.
      await admin.from("schedule_jobs").update({ inventory_deducted_at: new Date().toISOString() }).eq("id", job.id)
      alreadyHadMovement++
      continue
    }

    const { error: insertError } = await admin.from("stock_movements").insert({
      date: today,
      product_id: job.product_id,
      quantity_added: 0,
      quantity_removed: job.quantity,
      second_hand_ready_quantity: 0,
      second_hand_repair_quantity: 0,
      demo_quantity: 0,
      reason: "Filter Change",
      user_id: null,
      reference_number: job.order_no || job.id,
      schedule_job_id: job.id,
    })
    if (insertError) {
      errors.push(`${job.id}: ${insertError.message}`)
      continue
    }

    const { error: updateError } = await admin
      .from("schedule_jobs")
      .update({ inventory_deducted_at: new Date().toISOString() })
      .eq("id", job.id)
    if (updateError) {
      // The movement is in and already traceable via schedule_job_id — if
      // this update fails, the next run's "existingMovement" check above
      // catches it and finishes the job instead of double-deducting.
      errors.push(`${job.id} (movement inserted, mark-deducted failed): ${updateError.message}`)
      continue
    }

    deducted++
  }

  return NextResponse.json({
    checked: jobs?.length ?? 0,
    deducted,
    alreadyHadMovement,
    errors,
  })
}
