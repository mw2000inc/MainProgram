import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCustomerFilterChangeDueDate } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json) — for every customer whose next filter
// change is due (installed date/contract start + monitoring interval <=
// today) and doesn't already have an unresolved auto-generated entry,
// creates a normal "filter_change" schedule_jobs row scheduled for today
// (never in the past — a job overdue by weeks still needs to be handled now,
// not backdated to whenever it technically became due). These rows are
// indistinguishable from a manually-scheduled job (same table, same fields)
// so they're editable through the existing Schedule page/dialog as-is.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const [{ data: customers, error: customersError }, { data: settingsRow, error: settingsError }] = await Promise.all([
    admin.from("customers").select("id, order_number, installed_date, contract_start, dispenser_type, assigned_technician"),
    admin.from("company_settings").select("monitoring_default_months, monitoring_intervals").eq("id", 1).maybeSingle(),
  ])
  if (customersError) return NextResponse.json({ error: customersError.message }, { status: 500 })
  if (settingsError) return NextResponse.json({ error: settingsError.message }, { status: 500 })

  const settings = {
    monitoringDefaultMonths: settingsRow?.monitoring_default_months ?? 6,
    monitoringIntervals: (settingsRow?.monitoring_intervals as Record<string, number>) ?? {},
  }

  const today = new Date().toISOString().slice(0, 10)
  const validTechnicians: readonly string[] = TECHNICIANS

  let created = 0
  let alreadyPending = 0
  let notYetDue = 0
  let skippedNoAnchor = 0
  const errors: string[] = []

  for (const c of customers ?? []) {
    const anchor = c.installed_date ?? c.contract_start
    if (!anchor) {
      skippedNoAnchor++
      continue
    }

    const due = getCustomerFilterChangeDueDate(
      { installedDate: c.installed_date ?? undefined, contractStart: c.contract_start, dispenserType: c.dispenser_type },
      settings
    )
    const dueDate = due.toISOString().slice(0, 10)
    if (dueDate > today) {
      notYetDue++
      continue
    }

    // Idempotency: skip if this customer already has an unresolved
    // filter_change job (any date — an admin may have already rescheduled
    // it, which would break an exact-date match). Once it's marked
    // completed/cancelled, the next overdue cycle can create a new one.
    const { data: existing, error: existingError } = await admin
      .from("schedule_jobs")
      .select("id")
      .eq("customer_id", c.id)
      .eq("job_type", "filter_change")
      .eq("status", "pending")
      .maybeSingle()
    if (existingError) {
      errors.push(`${c.id}: ${existingError.message}`)
      continue
    }
    if (existing) {
      alreadyPending++
      continue
    }

    const technician = validTechnicians.includes(c.assigned_technician) ? c.assigned_technician : "N/A"
    const { error: insertError } = await admin.from("schedule_jobs").insert({
      job_type: "filter_change",
      technician,
      customer_id: c.id,
      order_no: c.order_number,
      scheduled_date: today,
      status: "pending",
      notes: `Auto-generated — filter change due ${dueDate}`,
    })
    if (insertError) {
      errors.push(`${c.id}: ${insertError.message}`)
      continue
    }
    created++
  }

  return NextResponse.json({
    checked: customers?.length ?? 0,
    created,
    alreadyPending,
    notYetDue,
    skippedNoAnchor,
    errors,
  })
}
