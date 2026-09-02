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
  sendSms,
} from "@/lib/dispatch-notifications-server"

export const dynamic = "force-dynamic"

// Admin's "yes, that date works" action on a Reschedule Requested item
// (the Pending Dispatch Approval queue's Reschedule Requests section) —
// see the reschedule_request_with_date migration for why this needs its
// own route (same reason /api/dispatch/approve does: real Semaphore/
// Resend credentials only ever live server-side). Unlike approve, this
// jumps straight to a "you're confirmed" notification rather than a
// "please confirm" ask — the customer already told us this exact date
// works when they requested it, so asking them to re-confirm their own
// suggestion would be redundant. Phone/email come from the row itself
// (already stored from the original approval), not from the request body
// — there's nothing for the admin to type in here.
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
  const { out_scheduled_date: scheduledDate, out_requested_time: requestedTime, out_notify_phone: notifyPhone, out_notify_email: notifyEmail, out_confirmation_token: token } = row

  const admin = createAdminClient()
  const { data: settingsRow } = await admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle()
  const companyName = settingsRow?.company_name || "MW2000"
  const moduleLabel = MODULE_LABELS[entityType]
  const actionPhrase = MODULE_ACTION_PHRASES[entityType]
  // Reuses the existing token from the original approval rather than
  // minting a new one — it was never invalidated by the reschedule
  // request, and get_dispatch_confirmation_details reads the schedule
  // date live, so this link already correctly shows "you're confirmed"
  // for the new date.
  const confirmUrl = token ? `${appBaseUrl(request)}/confirm/${token}` : undefined

  const result: { sms?: ChannelResult; email?: ChannelResult } = {}

  if (notifyPhone) {
    const message = buildSmsMessage({ companyName, actionPhrase, scheduledDate: scheduledDate ?? "", requestedTime, confirmUrl })
    const sendResult = await sendSms(notifyPhone, message)
    result.sms = sendResult
    await admin.from("dispatch_notifications").insert({
      entity_type: entityType,
      entity_id: entityId,
      channel: "sms",
      recipient: notifyPhone,
      message,
      status: sendResult.status,
      created_by: caller.id,
    })
  }

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

function buildSmsMessage({
  companyName,
  actionPhrase,
  scheduledDate,
  requestedTime,
  confirmUrl,
}: {
  companyName: string
  actionPhrase: string
  scheduledDate: string
  requestedTime: string | null
  confirmUrl: string | undefined
}): string {
  const when = requestedTime ? `${scheduledDate} at ${requestedTime}` : scheduledDate
  const lines = [
    "Hello Sir/Ma'am, good day! We hope you're doing well!",
    "",
    `Great news — ${companyName} has confirmed your requested reschedule for ${actionPhrase}: now set for ${when}.`,
  ]
  if (confirmUrl) lines.push("", `View your confirmation here: ${confirmUrl}`)
  lines.push("", `Thank you for choosing ${companyName}! We look forward to serving you. Have a wonderful day!`)
  return lines.join("\n")
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
