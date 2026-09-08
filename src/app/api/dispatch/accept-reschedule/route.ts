import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  type DispatchEntityType,
  type ChannelResult,
  MODULE_LABELS,
  MODULE_ACTION_PHRASES,
  escapeHtml,
  appBaseUrl,
  sendEmail,
} from "@/lib/dispatch-notifications-server"
import { autoAssignScheduleJob, fetchScheduleContext } from "@/lib/scheduling/smart-schedule"

export const dynamic = "force-dynamic"

// Admin's "yes, that date works" action on a Reschedule Requested item
// (the Pending Dispatch Approval queue's Reschedule Requests section) —
// see the reschedule_request_with_date migration for why this needs its
// own route (same reason /api/dispatch/approve does: real Resend
// credentials only ever live server-side). Unlike approve, this jumps
// straight to a "you're confirmed" notification rather than a "please
// confirm" ask — the customer already told us this exact date works when
// they requested it, so asking them to re-confirm their own suggestion
// would be redundant. Email comes from the row itself (already stored
// from the original approval), not from the request body — there's
// nothing for the admin to type in here.
//
// SMS was fully removed as a notification channel (email is the only one
// now) — accept_requested_reschedule() still returns out_notify_phone
// (harmless historical data from whatever the original approval stored;
// see dispatch-notifications-server.ts's own note), it's just no longer
// read here.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { entityType?: DispatchEntityType; entityId?: string } | null
  const entityType = body?.entityType
  const entityId = body?.entityId
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })
  }

  // Re-validates admin-ness itself (is_admin(), under the caller's own
  // session/RLS), same as approve_dispatch_item.
  const { data: rpcData, error: rpcError } = await supabase.rpc("accept_requested_reschedule", {
    p_entity_type: entityType,
    p_entity_id: entityId,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 403 })
  }
  const row = (
    rpcData as {
      out_ok: boolean
      out_label: string | null
      out_scheduled_date: string | null
      out_requested_time: string | null
      out_notify_phone: string | null
      out_notify_email: string | null
      out_confirmation_token: string | null
    }[]
  )?.[0]
  if (!row?.out_ok) {
    return NextResponse.json({ error: "This item is no longer a pending reschedule request." }, { status: 409 })
  }
  const { out_scheduled_date: scheduledDate, out_requested_time: requestedTime, out_notify_email: notifyEmail, out_confirmation_token: token } = row

  const admin = createAdminClient()

  // Smart Automatic Scheduling: safe to call unconditionally here, whether
  // accept_requested_reschedule() just relocated an already-staffed job in
  // place (Bug #1's fix — technician already set, autoAssignScheduleJob's
  // own "already staffed" check makes this a no-op) or fell through to
  // find_or_create_schedule_job for a record that never reached a plain
  // 'Confirmed' before (fresh row, technician still blank). Fire-and-forget
  // relative to the admin's own accept action, same reasoning as the
  // confirm route: a failure here must never turn a successful accept into
  // an error, and autoAssignScheduleJob never throws on its own.
  if (scheduledDate) {
    const ctx = await fetchScheduleContext(admin, entityType, entityId)
    if (ctx.scheduleJobId) {
      await autoAssignScheduleJob(admin, {
        scheduleJobId: ctx.scheduleJobId,
        jobType: ctx.jobType,
        entityType,
        entityId,
        customerId: ctx.customerId,
        orderNo: ctx.orderNo,
        scheduledDate,
      }).catch(() => {})
    }
  }
  const { data: settingsRow } = await admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle()
  const companyName = settingsRow?.company_name || "MW2000"
  const moduleLabel = MODULE_LABELS[entityType]
  const actionPhrase = MODULE_ACTION_PHRASES[entityType]
  // token here is a FRESH one minted by accept_requested_reschedule() itself
  // (see the reschedule_accept_fresh_token migration), not the original
  // approval's — that one is genuinely invalidated by this exact accept,
  // via reset_dispatch_status_on_pre_d_change firing when pre_d changes
  // (its own documented behavior: invalidate a token that's about to point
  // at a moved date). get_dispatch_confirmation_details reads the schedule
  // date live, so this new link still correctly shows "you're confirmed"
  // for the new date.
  const confirmUrl = token ? `${appBaseUrl(request)}/confirm/${token}` : undefined

  // notifyEmail is normally always present here — approve now requires it
  // — but this guard is kept for a row approved before this change with
  // only a phone on file (email null): with SMS gone, such a row simply
  // gets no "you're confirmed" notification sent, which is an accepted
  // consequence of removing the channel entirely, not a bug to work around.
  const result: { email?: ChannelResult } = {}

  if (notifyEmail) {
    const { subject, html, text } = buildEmailContent({
      companyName,
      moduleLabel,
      actionPhrase,
      scheduledDate: scheduledDate ?? "",
      requestedTime,
      confirmUrl,
    })
    const sendResult = await sendEmail(notifyEmail, subject, html, text)
    result.email = sendResult
    await admin.from("dispatch_notifications").insert({
      entity_type: entityType,
      entity_id: entityId,
      channel: "email",
      recipient: notifyEmail,
      message: text,
      status: sendResult.status,
      created_by: caller.id,
    })
  }

  return NextResponse.json(result)
}

function buildEmailContent({
  companyName,
  moduleLabel,
  actionPhrase,
  scheduledDate,
  requestedTime,
  confirmUrl,
}: {
  companyName: string
  moduleLabel: string
  actionPhrase: string
  scheduledDate: string
  requestedTime: string | null
  confirmUrl: string | undefined
}): { subject: string; html: string; text: string } {
  const when = requestedTime ? `${scheduledDate} at ${requestedTime}` : scheduledDate
  const subject = `${companyName}: Your rescheduled ${moduleLabel} is now confirmed — ${when}`
  const buttonHtml = confirmUrl
    ? `<a href="${confirmUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">View Confirmation</a><p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">If the button doesn't work, copy this link: ${confirmUrl}</p>`
    : ""
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 16px;color:#0f172a;">Hello Sir/Ma'am, good day! 😊 We hope you're doing well!</p>
      <p style="margin:0 0 24px;color:#0f172a;">Great news — <strong>${escapeHtml(companyName)}</strong> has confirmed your requested reschedule for ${escapeHtml(actionPhrase)}: now set for <strong>${escapeHtml(when)}</strong>.</p>
      ${buttonHtml}
      <p style="margin:24px 0 0;color:#0f172a;">Thank you for choosing ${escapeHtml(companyName)}! We look forward to serving you. Have a wonderful day! 😊</p>
    </div>
  `.trim()
  const textLines = [
    "Hello Sir/Ma'am, good day! 😊 We hope you're doing well!",
    "",
    `Great news — ${companyName} has confirmed your requested reschedule for ${actionPhrase}: now set for ${when}.`,
  ]
  if (confirmUrl) textLines.push("", `View your confirmation here: ${confirmUrl}`)
  textLines.push("", `Thank you for choosing ${companyName}! We look forward to serving you. Have a wonderful day! 😊`)
  return { subject, html, text: textLines.join("\n") }
}
