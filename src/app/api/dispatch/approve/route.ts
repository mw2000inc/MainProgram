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

// Real SMS (Semaphore) + Email (Resend) dispatch-approval delivery — see
// the dispatch_dual_channel_notifications migration's own comment for why
// this lives here rather than in the approve_dispatch_item() RPC itself
// (Postgres can't make outbound HTTP calls the way this project is set
// up). This route does the admin recheck + DB transition via the caller's
// own session (same RLS-backed is_admin() check as before, just reached
// through a route instead of a direct client-side RPC call), then the
// real sends, then logs exactly what happened — 'sent' or 'failed' per
// channel, never a blind stub — via the service-role client, matching
// src/app/api/admin/users/route.ts's own recheck-then-service-role
// pattern.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    entityType?: DispatchEntityType
    entityId?: string
    notifyPhone?: string
    notifyEmail?: string
  } | null
  const entityType = body?.entityType
  const entityId = body?.entityId
  const notifyPhone = body?.notifyPhone?.trim() || undefined
  const notifyEmail = body?.notifyEmail?.trim() || undefined
  if (!entityType || !entityId || (!notifyPhone && !notifyEmail)) {
    return NextResponse.json({ error: "entityType, entityId, and at least one of notifyPhone/notifyEmail are required" }, { status: 400 })
  }

  // Re-validates admin-ness itself (is_admin(), under the caller's own
  // session/RLS) — this route doesn't separately gate on role the way
  // /api/admin/users does, since the RPC already raises if the caller
  // isn't an admin, and that exception surfaces as a Postgres error below.
  const { data: rpcData, error: rpcError } = await supabase.rpc("approve_dispatch_item", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_notify_phone: notifyPhone ?? null,
    p_notify_email: notifyEmail ?? null,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 403 })
  }
  const row = (rpcData as { out_token: string | null; out_label: string | null; out_scheduled_date: string | null }[])?.[0]
  if (!row?.out_token) {
    return NextResponse.json({ error: "This item is no longer awaiting approval." }, { status: 409 })
  }
  const { out_token: token, out_scheduled_date: scheduledDate } = row

  const admin = createAdminClient()
  const [{ data: settingsRow }, address] = await Promise.all([
    admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle(),
    getEntityAddress(admin, entityType, entityId),
  ])
  const companyName = settingsRow?.company_name || "MW2000"
  const moduleLabel = MODULE_LABELS[entityType]
  const actionPhrase = MODULE_ACTION_PHRASES[entityType]
  const confirmUrl = `${appBaseUrl(request)}/confirm/${token}`

  const result: { sms?: ChannelResult; email?: ChannelResult } = {}

  if (notifyPhone) {
    const message = buildSmsMessage({ companyName, actionPhrase, scheduledDate: scheduledDate ?? "", address, confirmUrl })
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
    const { subject, html, text } = buildEmailContent({ companyName, moduleLabel, actionPhrase, scheduledDate: scheduledDate ?? "", address, confirmUrl })
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

  return NextResponse.json({ token, confirmUrl, ...result })
}

// Best-effort service address for the message body — only two of the four
// tables carry one directly (Filter Change, Installation); Collections
// only has one indirectly, via an optional customer link that not every
// row has (see the ct_filter_change_collection_inventory_link migration);
// Repair has no address or customer link at all (see the
// dispatch_confirmation_workflow migration's own note on that gap). A
// null return just means the message omits the "at <address>" clause —
// see buildSmsMessage.
async function getEntityAddress(
  admin: ReturnType<typeof createAdminClient>,
  entityType: DispatchEntityType,
  entityId: string
): Promise<string | null> {
  if (entityType === "filter_change_plans" || entityType === "install_plans") {
    const { data } = await admin.from(entityType).select("address").eq("id", entityId).maybeSingle()
    return (data as { address: string | null } | null)?.address ?? null
  }
  if (entityType === "collections") {
    const { data: collection } = await admin.from("collections").select("customer_id").eq("id", entityId).maybeSingle()
    const customerId = (collection as { customer_id: string | null } | null)?.customer_id
    if (!customerId) return null
    const { data: customer } = await admin.from("customers").select("address").eq("id", customerId).maybeSingle()
    return (customer as { address: string | null } | null)?.address ?? null
  }
  return null
}

// Warmer, more conversational copy (confirmed wording) — SMS asks for a
// reply since that's the natural action on a phone, but still includes
// the same functional confirm/reschedule link right after it (the reply
// path is best-effort — see /api/webhooks/sms-reply — the link is the
// one fully-working confirmation path for every case). Email points at
// the button instead of "reply". No emoji here on purpose (kept in
// buildEmailContent below) — they'd force this into UCS-2 encoding and
// roughly double the billed SMS segment count for two characters; the
// wording alone already carries the warm tone. Plain ASCII throughout
// keeps this on GSM-7 (~153 chars/segment) instead.
function buildSmsMessage({
  companyName,
  actionPhrase,
  scheduledDate,
  address,
  confirmUrl,
}: {
  companyName: string
  actionPhrase: string
  scheduledDate: string
  address: string | null
  confirmUrl: string
}): string {
  const location = address ? ` at ${address}` : ""
  return [
    "Hello Sir/Ma'am, good day! We hope you're doing well!",
    "",
    `This is a friendly reminder from ${companyName} that we have ${actionPhrase} scheduled for ${scheduledDate}${location}.`,
    "",
    `We'd be happy to assist you with the service. Kindly reply to this message to confirm if the scheduled date works for you, or tap this link to confirm or request a reschedule: ${confirmUrl}`,
    "",
    `Thank you for choosing ${companyName}! We look forward to serving you. Have a wonderful day!`,
  ].join("\n")
}

function buildEmailContent({
  companyName,
  moduleLabel,
  actionPhrase,
  scheduledDate,
  address,
  confirmUrl,
}: {
  companyName: string
  moduleLabel: string
  actionPhrase: string
  scheduledDate: string
  address: string | null
  confirmUrl: string
}): { subject: string; html: string; text: string } {
  const subject = `${companyName}: Your ${moduleLabel} is scheduled for ${scheduledDate}`
  const addressLine = address ? `<p style="margin:0 0 16px;color:#475569;">Location: ${escapeHtml(address)}</p>` : ""
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 16px;color:#0f172a;">Hello Sir/Ma'am, good day! 😊 We hope you're doing well!</p>
      <p style="margin:0 0 16px;color:#0f172a;">This is a friendly reminder from <strong>${escapeHtml(companyName)}</strong> that we have ${escapeHtml(actionPhrase)} scheduled for <strong>${escapeHtml(scheduledDate)}</strong>.</p>
      ${addressLine}
      <p style="margin:0 0 24px;color:#475569;">We'd be happy to assist you with the service — please use the button below to confirm if this date works for you, or let us know if you'd like to reschedule.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Confirm or Reschedule</a>
      <p style="margin:24px 0 8px;color:#94a3b8;font-size:12px;">If the button doesn't work, copy this link: ${confirmUrl}</p>
      <p style="margin:24px 0 0;color:#0f172a;">Thank you for choosing ${escapeHtml(companyName)}! We look forward to serving you. Have a wonderful day! 😊</p>
    </div>
  `.trim()
  const textLines = [
    "Hello Sir/Ma'am, good day! 😊 We hope you're doing well!",
    "",
    `This is a friendly reminder from ${companyName} that we have ${actionPhrase} scheduled for ${scheduledDate}.`,
  ]
  // Only the address line is conditional — the blank lines around it are
  // deliberate paragraph breaks, not filler to strip.
  if (address) textLines.push(`Location: ${address}`)
  textLines.push(
    "",
    "We'd be happy to assist you with the service. Please use this link to confirm if this date works for you, or let us know if you'd like to reschedule:",
    confirmUrl,
    "",
    `Thank you for choosing ${companyName}! We look forward to serving you. Have a wonderful day! 😊`
  )
  const text = textLines.join("\n")
  return { subject, html, text }
}
