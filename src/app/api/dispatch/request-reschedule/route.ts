import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  type DispatchEntityType,
  type ChannelResult,
  MODULE_LABELS,
  MODULE_ACTION_PHRASES,
  escapeHtml,
  sendEmail,
} from "@/lib/dispatch-notifications-server"

export const dynamic = "force-dynamic"

// Admin's "Request Reschedule" on a Pending Approvals item (Schedule page)
// — the admin-initiated mirror of a customer's own reschedule request (see
// request_reschedule_by_admin's own comment for exactly which states this
// is valid from and why). This is informational only: it tells the
// customer a different date is needed and why, but doesn't hand them a new
// self-service link the way the original approval's confirm link did —
// the admin is expected to settle on a new date (by phone, etc.), update
// Pre D, and re-Approve through the existing flow, which is what actually
// sends a fresh confirmation. Same server-route-for-a-real-email reasoning
// as every other dispatch action here.
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
    reason?: string
  } | null
  const entityType = body?.entityType
  const entityId = body?.entityId
  const reason = body?.reason?.trim()
  if (!entityType || !entityId || !reason) {
    return NextResponse.json({ error: "entityType, entityId, and reason are required" }, { status: 400 })
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("request_reschedule_by_admin", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_reason: reason,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 403 })
  }
  const row = (rpcData as { out_ok: boolean; out_label: string | null; out_notify_email: string | null }[])?.[0]
  if (!row?.out_ok) {
    return NextResponse.json(
      { error: "This item is no longer awaiting initial approval — it may already have a customer-requested date, be scheduled, or be resolved." },
      { status: 409 }
    )
  }

  const result: { email?: ChannelResult } = {}
  if (row.out_notify_email) {
    const admin = createAdminClient()
    const { data: settingsRow } = await admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle()
    const companyName = settingsRow?.company_name || "MW2000"
    const moduleLabel = MODULE_LABELS[entityType]
    const actionPhrase = MODULE_ACTION_PHRASES[entityType]
    const { subject, html, text } = buildRescheduleEmail({ companyName, moduleLabel, actionPhrase, reason })
    const sendResult = await sendEmail(row.out_notify_email, subject, html, text)
    result.email = sendResult
    await admin.from("dispatch_notifications").insert({
      entity_type: entityType,
      entity_id: entityId,
      channel: "email",
      recipient: row.out_notify_email,
      message: text,
      status: sendResult.status,
      created_by: caller.id,
    })
  }

  return NextResponse.json(result)
}

function buildRescheduleEmail({
  companyName,
  moduleLabel,
  actionPhrase,
  reason,
}: {
  companyName: string
  moduleLabel: string
  actionPhrase: string
  reason: string
}): { subject: string; html: string; text: string } {
  const subject = `${companyName}: We need to reschedule your ${moduleLabel}`
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 16px;color:#0f172a;">Hello Sir/Ma'am, good day! 😊</p>
      <p style="margin:0 0 16px;color:#0f172a;">We need to find a new date for ${escapeHtml(actionPhrase)}.</p>
      <p style="margin:0 0 24px;color:#475569;">${escapeHtml(reason)}</p>
      <p style="margin:0 0 24px;color:#475569;">We'll be in touch to arrange a new date — feel free to reach out to us in the meantime.</p>
      <p style="margin:24px 0 0;color:#0f172a;">Thank you for your patience, and for choosing ${escapeHtml(companyName)}!</p>
    </div>
  `.trim()
  const text = [
    "Hello Sir/Ma'am, good day! 😊",
    "",
    `We need to find a new date for ${actionPhrase}.`,
    "",
    reason,
    "",
    "We'll be in touch to arrange a new date — feel free to reach out to us in the meantime.",
    "",
    `Thank you for your patience, and for choosing ${companyName}!`,
  ].join("\n")
  return { subject, html, text }
}
