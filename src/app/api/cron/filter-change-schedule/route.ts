import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCustomerFilterChangeDueDate, getCpSystemFilterChangeDueDate } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"
import type { CpSystemComponent } from "@/lib/types"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json) — for every customer whose next filter
// change is due (installed date/contract start + monitoring interval <=
// today) and doesn't already have an unresolved auto-generated entry,
// creates a normal "filter_change" schedule_jobs row scheduled for today
// (never in the past — a job overdue by weeks still needs to be handled now,
// not backdated to whenever it technically became due). These rows are
// indistinguishable from a manually-scheduled job (same table, same fields)
// so they're editable through the existing Schedule page/dialog as-is.
//
// This is Pass 1, covering every customer via the flat dispenser_type +
// Settings interval. Pass 2 below covers orders with a real CP System
// linked (sale_list_entries.cp_system_id) — deliberately a second,
// independent loop rather than folded into this one: Pass 1's idempotency
// check is one-open-job-per-customer, which is wrong once a customer can
// have several linked orders each due on their own schedule, so Pass 2 keys
// its own dedup on the order instead.
//
// Known overlap case: Pass 1 has no notion of a CP System link, so if a
// customer's own order_number happens to be the same order a CP System is
// linked to, Pass 1 can still beat Pass 2 to creating that order's job, off
// the less-accurate flat interval — Pass 2 then sees that pending job
// (matching order_no) and skips, deferring to whichever fired first rather
// than always preferring the CP System's own date. Not fixed here: the
// failure mode is "an extra/early auto-job appears," never "a filter change
// silently never gets scheduled," and reconciling the two would mean Pass 1
// learning about links it's deliberately kept ignorant of. Revisit if this
// turns out to matter in practice.
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

  // =========================================================================
  // Pass 2 — orders explicitly linked to a CP System (see the top-of-file
  // comment for why this is a second, independent loop rather than folded
  // into Pass 1 above). Anchored on the ORDER's own installed_date, paced by
  // the linked system's shortest component interval (see
  // getCpSystemFilterChangeDueDate), and deduped per order_no rather than
  // per customer — a customer with two linked orders on two different
  // systems can have both due independently.
  // =========================================================================
  const { data: linkedEntries, error: linkedEntriesError } = await admin
    .from("sale_list_entries")
    .select("id, order_number, installed_date, customer_id, status, cp_systems(components)")
    .not("cp_system_id", "is", null)
  if (linkedEntriesError) return NextResponse.json({ error: linkedEntriesError.message }, { status: 500 })

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]))

  let cpCreated = 0
  let cpAlreadyPending = 0
  let cpNotYetDue = 0
  let cpSkipped = 0
  const cpErrors: string[] = []

  // `cp_systems` is a many-to-one embed (sale_list_entries.cp_system_id ->
  // cp_systems.id) — PostgREST returns a single nested object for that
  // direction, same as e.g. announcements.ts's `author:profiles(name)`, not
  // an array. The client has no generated Database type to confirm that at
  // compile time, so it defaults to an array shape here; `unknown` bridges
  // the two rather than asserting straight across.
  type LinkedEntry = {
    id: string
    order_number: string
    installed_date: string | null
    customer_id: string | null
    status: string
    cp_systems: { components: CpSystemComponent[] } | null
  }
  for (const entry of (linkedEntries ?? []) as unknown as LinkedEntry[]) {
    // A cancelled/discontinued order (see collections-columns.tsx's own
    // comment on this same status value) shouldn't keep generating visits —
    // every other status (ACTIVE, RENT, DIY) still can.
    if (entry.status === "INACTIVE") {
      cpSkipped++
      continue
    }

    const orderNo = entry.order_number?.trim()
    const components = entry.cp_systems?.components ?? []
    if (!entry.installed_date || !orderNo || components.length === 0) {
      cpSkipped++
      continue
    }

    const due = getCpSystemFilterChangeDueDate(entry.installed_date, components)
    if (!due) {
      cpSkipped++
      continue
    }
    const dueDate = due.toISOString().slice(0, 10)
    if (dueDate > today) {
      cpNotYetDue++
      continue
    }

    // Idempotency: skip if this exact order already has an unresolved
    // filter_change job — same "any date, not just an exact match" reasoning
    // as Pass 1 (an admin may have already rescheduled it).
    const { data: existing, error: existingError } = await admin
      .from("schedule_jobs")
      .select("id")
      .eq("order_no", orderNo)
      .eq("job_type", "filter_change")
      .eq("status", "pending")
      .maybeSingle()
    if (existingError) {
      cpErrors.push(`${entry.id}: ${existingError.message}`)
      continue
    }
    if (existing) {
      cpAlreadyPending++
      continue
    }

    const customer = entry.customer_id ? customerById.get(entry.customer_id) : undefined
    const technician = customer && validTechnicians.includes(customer.assigned_technician) ? customer.assigned_technician : "N/A"

    const { error: insertError } = await admin.from("schedule_jobs").insert({
      job_type: "filter_change",
      technician,
      customer_id: entry.customer_id,
      order_no: orderNo,
      scheduled_date: today,
      status: "pending",
      notes: `Auto-generated — filter change due ${dueDate} (CP System)`,
    })
    if (insertError) {
      cpErrors.push(`${entry.id}: ${insertError.message}`)
      continue
    }
    cpCreated++
  }

  return NextResponse.json({
    checked: customers?.length ?? 0,
    created,
    alreadyPending,
    notYetDue,
    skippedNoAnchor,
    errors,
    cpSystem: {
      checked: linkedEntries?.length ?? 0,
      created: cpCreated,
      alreadyPending: cpAlreadyPending,
      notYetDue: cpNotYetDue,
      skipped: cpSkipped,
      errors: cpErrors,
    },
  })
}
