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

// Admin's outright "Reject" on a Pending Approvals item (Schedule page) —
// same reason every other dispatch action lives in a route rather than a
// plain client-side RPC call: a real email needs Resend credentials, which
// only ever live server-side. reject_dispatch_item() does the actual DB
// transition (admin recheck + the valid-from-state guard) under the
// caller's own session; this route only adds the customer-facing "declined"
// notification on top, using whatever notify_email is already on file (a
// Draft item rejected before ever being approved may have none at all —
// see getEntityAddress's own precedent in the approve route for the same
// kind of best-effort gap — in which case this silently sends nothing,
// same as notifyAdminOfResponse's own guard in /api/dispatch/respond).
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
  const reason = body?.reason?.trim() || undefined
  if (!entityType || !entityId) {
    return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("reject_dispatch_item", {
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_reason: reason ?? null,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 403 })
  }
  const row = (rpcData as { out_ok: boolean; out_label: string | null; out_notify_email: string | null }[])?.[0]
  if (!row?.out_ok) {
    return NextResponse.json({ error: "This item can no longer be rejected — it may already be scheduled, rejected, or removed." }, { status: 409 })
  }

  const result: { email?: ChannelResult } = {}
  if (row.out_notify_email) {
    const admin = createAdminClient()
    const [{ data: settingsRow }] = await Promise.all([admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle()])
    const companyName = settingsRow?.company_name || "MW2000"
    const moduleLabel = MODULE_LABELS[entityType]
    const actionPhrase = MODULE_ACTION_PHRASES[entityType]
    const { subject, html, text } = buildRejectEmail({ companyName, moduleLabel, actionPhrase, reason })
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

function buildRejectEmail({
  companyName,
  moduleLabel,
  actionPhrase,
  reason,
}: {
  companyName: string
  moduleLabel: string
  actionPhrase: string
  reason?: string
}): { subject: string; html: string; text: string } {
  const subject = `${companyName}: Update on your ${moduleLabel} request`
  const reasonLine = reason ? `<p style="margin:0 0 16px;color:#475569;">Reason: ${escapeHtml(reason)}</p>` : ""
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 16px;color:#0f172a;">Hello Sir/Ma'am, good day! 😊</p>
      <p style="margin:0 0 16px;color:#0f172a;">We're unable to proceed with ${escapeHtml(actionPhrase)} as requested.</p>
      ${reasonLine}
      <p style="margin:0 0 24px;color:#475569;">Please get in touch with us so we can help arrange this differently.</p>
      <p style="margin:24px 0 0;color:#0f172a;">Thank you for choosing ${escapeHtml(companyName)}!</p>
    </div>
  `.trim()
  const textLines = [
    "Hello Sir/Ma'am, good day! 😊",
    "",
    `We're unable to proceed with ${actionPhrase} as requested.`,
  ]
  if (reason) textLines.push(`Reason: ${reason}`)
  textLines.push("", "Please get in touch with us so we can help arrange this differently.", "", `Thank you for choosing ${companyName}!`)
  return { subject, html, text: textLines.join("\n") }
}
