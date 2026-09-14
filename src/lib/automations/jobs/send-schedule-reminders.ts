import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  MODULE_LABELS,
  MODULE_ACTION_PHRASES,
  escapeHtml,
  sendEmail,
  formatUsDate,
  formatScheduleWhen,
  buildScheduleSummary,
  PRODUCTION_BASE_URL,
} from "@/lib/dispatch-notifications-server"
import { sendPushToCustomer } from "@/lib/push-notifications-server"
import type { AutomationResult } from "../types"

type ReminderEntityType = "filter_change_plans" | "collections"

// One shape for both source tables — collapses filter_change_plans' and
// collections' own differently-named columns (order_number/order_no,
// member_account/account_name, plan_date/collection_date) into a single
// candidate record the rest of this job works from, the same flattening
// approach getEntityAddress/getEntityTechnician already use across the four
// dispatch tables (see dispatch-notifications-server.ts).
interface ReminderCandidate {
  entityType: ReminderEntityType
  id: string
  customerId: string | null
  technician: string | null
  notifyEmail: string | null
  scheduleJobId: string | null
  scheduledDate: string
}

// Runs daily (see /api/cron/send-schedule-reminders and vercel.json) —
// reminds a customer 2 calendar days before a CONFIRMED Filter Change or
// Collection visit. Deliberately scoped to dispatch_status = 'Confirmed'
// only: Draft/Pending Customer Confirmation/Reschedule Requested aren't a
// locked-in date yet (nothing to remind about), and Rejected is the
// closest thing either table has to "cancelled." A linked schedule_jobs
// row with status 'completed'/'cancelled' is also excluded even though its
// plan is still 'Confirmed' — the job itself is done or was called off
// after the plan-level status stopped tracking that. two_day_reminder_
// sent_at (set at the bottom of this file, cleared automatically by the
// reset_two_day_reminder_on_date_change trigger whenever pre_d moves) is
// the sole de-dup guard against a second send for the same scheduled date.
export async function runSendScheduleReminders(): Promise<AutomationResult> {
  const admin = createAdminClient()

  const now = new Date()
  const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2))
    .toISOString()
    .slice(0, 10)

  const [{ data: filterChangeRows, error: fcError }, { data: collectionRows, error: colError }] = await Promise.all([
    admin
      .from("filter_change_plans")
      .select("id, customer_id, serviceman, notify_email, schedule_job_id, plan_date, pre_d")
      .eq("dispatch_status", "Confirmed")
      .is("two_day_reminder_sent_at", null),
    admin
      .from("collections")
      .select("id, customer_id, serviceman, notify_email, schedule_job_id, collection_date, pre_d")
      .eq("dispatch_status", "Confirmed")
      .is("two_day_reminder_sent_at", null),
  ])
  if (fcError) return { ok: false, message: fcError.message }
  if (colError) return { ok: false, message: colError.message }

  // The effective scheduled date is pre_d once a plan has one, same
  // coalesce every other dispatch flow in this app already applies
  // (respond_to_dispatch_confirmation, accept_requested_reschedule) —
  // filtering here in application code (rather than a raw SQL predicate
  // PostgREST can't express) since the candidate set is small enough that
  // pulling every still-unreminded Confirmed row and comparing in JS costs
  // nothing real, the same tradeoff generate-filter-change-jobs.ts already
  // makes for its own due-date check.
  const candidates: ReminderCandidate[] = [
    ...(filterChangeRows ?? [])
      .filter((r) => (r.pre_d ?? r.plan_date) === targetDate)
      .map((r) => ({
        entityType: "filter_change_plans" as const,
        id: r.id,
        customerId: r.customer_id,
        technician: r.serviceman || null,
        notifyEmail: r.notify_email,
        scheduleJobId: r.schedule_job_id,
        scheduledDate: (r.pre_d ?? r.plan_date) as string,
      })),
    ...(collectionRows ?? [])
      .filter((r) => (r.pre_d ?? r.collection_date) === targetDate)
      .map((r) => ({
        entityType: "collections" as const,
        id: r.id,
        customerId: r.customer_id,
        technician: r.serviceman || null,
        notifyEmail: r.notify_email,
        scheduleJobId: r.schedule_job_id,
        scheduledDate: (r.pre_d ?? r.collection_date) as string,
      })),
  ]

  if (candidates.length === 0) {
    return { ok: true, message: `No Confirmed schedules found for ${formatUsDate(targetDate)}.`, detail: { targetDate, checked: 0 } }
  }

  const scheduleJobIds = [...new Set(candidates.map((c) => c.scheduleJobId).filter((id): id is string => !!id))]
  const customerIds = [...new Set(candidates.map((c) => c.customerId).filter((id): id is string => !!id))]

  const [{ data: jobRows }, { data: customerRows }, { data: settingsRow }] = await Promise.all([
    scheduleJobIds.length > 0
      ? admin.from("schedule_jobs").select("id, status, scheduled_time").in("id", scheduleJobIds)
      : Promise.resolve({ data: [] as { id: string; status: string; scheduled_time: string | null }[] }),
    customerIds.length > 0
      ? admin.from("customers").select("id, email").in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; email: string | null }[] }),
    admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle(),
  ])
  const jobsById = new Map((jobRows ?? []).map((j) => [j.id, j]))
  const customersById = new Map((customerRows ?? []).map((c) => [c.id, c]))
  const companyName = settingsRow?.company_name || "MW2000"

  let sent = 0
  let skippedJobDone = 0
  let skippedNoCustomer = 0
  let skippedNoChannel = 0
  const errors: string[] = []

  for (const candidate of candidates) {
    const job = candidate.scheduleJobId ? jobsById.get(candidate.scheduleJobId) : undefined
    if (job && (job.status === "completed" || job.status === "cancelled")) {
      skippedJobDone++
      continue
    }

    // No customer link means no portal to send them to and no push
    // subscription to look up — the same "reliable customer_id link"
    // requirement /api/dispatch/approve/route.ts's own push send already
    // holds Filter Change/Collections to.
    if (!candidate.customerId) {
      skippedNoCustomer++
      continue
    }

    const customer = customersById.get(candidate.customerId)
    const notifyEmail = candidate.notifyEmail || customer?.email || null
    const scheduledTime = job?.scheduled_time || null

    try {
      let emailSent = false
      if (notifyEmail) {
        const { subject, html, text } = buildReminderEmail({
          companyName,
          entityType: candidate.entityType,
          scheduledDate: candidate.scheduledDate,
          scheduledTime,
          technician: candidate.technician,
          customerId: candidate.customerId,
        })
        const result = await sendEmail(notifyEmail, subject, html, text)
        emailSent = result.status === "sent"
        await admin.from("dispatch_notifications").insert({
          entity_type: candidate.entityType,
          entity_id: candidate.id,
          channel: "email",
          recipient: notifyEmail,
          message: text,
          status: result.status,
          created_by: null,
        })
      }

      const when = formatScheduleWhen(candidate.scheduledDate, scheduledTime)
      const pushAttempted = await sendPushToCustomer(admin, candidate.customerId, {
        title: "Upcoming Service Reminder 🛠️",
        body: `Your ${MODULE_LABELS[candidate.entityType]} is scheduled for ${when}. Tap to view details.`,
        url: `/scan/${candidate.customerId}`,
      })

      if (!emailSent && pushAttempted === 0) {
        skippedNoChannel++
        continue
      }

      await admin.from(candidate.entityType).update({ two_day_reminder_sent_at: new Date().toISOString() }).eq("id", candidate.id)
      sent++
    } catch (err) {
      errors.push(`${candidate.entityType}/${candidate.id}: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
  }

  return {
    ok: errors.length === 0,
    message: `${formatUsDate(targetDate)}: ${candidates.length} due, ${sent} reminded, ${errors.length} error(s).`,
    detail: { targetDate, checked: candidates.length, sent, skippedJobDone, skippedNoCustomer, skippedNoChannel, errors },
  }
}

function buildReminderEmail({
  companyName,
  entityType,
  scheduledDate,
  scheduledTime,
  technician,
  customerId,
}: {
  companyName: string
  entityType: ReminderEntityType
  scheduledDate: string
  scheduledTime: string | null
  technician: string | null
  customerId: string
}): { subject: string; html: string; text: string } {
  const moduleLabel = MODULE_LABELS[entityType]
  const actionPhrase = MODULE_ACTION_PHRASES[entityType]
  const formattedDate = formatUsDate(scheduledDate)
  const subject = `${companyName}: Reminder — Upcoming ${moduleLabel} Scheduled for ${formattedDate}`
  const portalUrl = `${PRODUCTION_BASE_URL}/scan/${customerId}`
  const { html: scheduleSummaryHtml, textLines: scheduleSummaryTextLines } = buildScheduleSummary({
    scheduledDate,
    scheduledTime,
    technician,
  })

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 16px;color:#0f172a;">Hello Sir/Ma'am, good day! 😊 We hope you're doing well!</p>
      <p style="margin:0 0 16px;color:#0f172a;">This is a friendly reminder that <strong>${escapeHtml(actionPhrase)}</strong> is coming up in 2 days, on <strong>${escapeHtml(formattedDate)}</strong>.</p>
      ${scheduleSummaryHtml}
      <p style="margin:0 0 24px;color:#475569;">You can review your service history and details anytime on your customer portal.</p>
      <a href="${portalUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">View My Details</a>
      <p style="margin:24px 0 8px;color:#94a3b8;font-size:12px;">If the button doesn't work, copy this link: ${portalUrl}</p>
      <p style="margin:24px 0 0;color:#0f172a;">Thank you for choosing ${escapeHtml(companyName)}! We look forward to serving you. Have a wonderful day! 😊</p>
    </div>
  `.trim()

  const textLines = [
    "Hello Sir/Ma'am, good day! 😊 We hope you're doing well!",
    "",
    `This is a friendly reminder that ${actionPhrase} is coming up in 2 days, on ${formattedDate}.`,
  ]
  if (scheduleSummaryTextLines.length > 0) textLines.push("", ...scheduleSummaryTextLines)
  textLines.push(
    "",
    "You can review your service history and details anytime on your customer portal:",
    portalUrl,
    "",
    `Thank you for choosing ${companyName}! We look forward to serving you. Have a wonderful day! 😊`
  )
  return { subject, html, text: textLines.join("\n") }
}
