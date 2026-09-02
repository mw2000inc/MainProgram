import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { type DispatchEntityType, MODULE_LABELS, escapeHtml, appBaseUrl, dashboardRecordUrl, sendEmail } from "@/lib/dispatch-notifications-server"

export const dynamic = "force-dynamic"

// Public, no-login endpoint — the customer clicking Confirm/Request a
// different date on their own /confirm/[token] page hits this instead of
// calling the DB RPC straight from the browser (see the
// respond_returns_entity_details migration's own comment for why: an
// admin-notification email needs real server-side Resend credentials,
// which — same as /api/dispatch/approve — can only ever live here, not in
// client code). The actual authorization boundary is unchanged: the token
// itself, validated inside respond_to_dispatch_confirmation() exactly as
// before. This route adds nothing to that check.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: string
    action?: "confirm" | "reschedule"
    requestedDate?: string
    requestedTime?: string
  } | null
  const token = body?.token
  const action = body?.action
  if (!token || !action) {
    return NextResponse.json({ error: "token and action are required" }, { status: 400 })
  }

  // Same anon-level client the browser used to call this RPC with
  // directly — no elevation needed here, the RPC is SECURITY DEFINER and
  // does its own token/expiry/status validation. requestedDate/
  // requestedTime are only meaningful for 'reschedule' — the RPC itself
  // ignores them for 'confirm'.
  const supabase = await createClient()
  const { data: rpcData, error: rpcError } = await supabase.rpc("respond_to_dispatch_confirmation", {
    p_token: token,
    p_action: action,
    p_requested_date: body?.requestedDate || null,
    p_requested_time: body?.requestedTime || null,
  })
  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }
  const row = (
    rpcData as {
      out_ok: boolean
      out_status: string | null
      out_entity_type: DispatchEntityType | null
      out_entity_id: string | null
      out_label: string | null
      out_scheduled_date: string | null
    }[]
  )?.[0]

  // Matches the client's existing contract exactly (ok/status only) —
  // everything else the RPC now returns is used below, server-side, to
  // build the admin email, never exposed in the response.
  if (!row?.out_ok) {
    return NextResponse.json({ ok: false, status: null })
  }

  await notifyAdminOfResponse(request, {
    entityType: row.out_entity_type as DispatchEntityType,
    entityId: row.out_entity_id as string,
    label: row.out_label ?? "",
    scheduledDate: row.out_scheduled_date ?? "",
    status: row.out_status as "Confirmed" | "Reschedule Requested",
    requestedDate: body?.requestedDate,
    requestedTime: body?.requestedTime,
  })

  return NextResponse.json({ ok: true, status: row.out_status })
}

// "Support Email" + "Email Notifications" in Settings have existed since
// early in this app but never actually drove a real send anywhere — this
// is the first thing to use that pair for its evidently-intended purpose,
// rather than introducing a separate new setting. Toggle off, or the
// address left blank, just skips silently — this is a nice-to-know for
// the admin, not something that should ever block or error out the
// customer's own confirm/reschedule action above.
async function notifyAdminOfResponse(
  request: Request,
  {
    entityType,
    entityId,
    label,
    scheduledDate,
    status,
    requestedDate,
    requestedTime,
  }: {
    entityType: DispatchEntityType
    entityId: string
    label: string
    scheduledDate: string
    status: "Confirmed" | "Reschedule Requested"
    requestedDate?: string
    requestedTime?: string
  }
): Promise<void> {
  const admin = createAdminClient()
  const { data: settingsRow } = await admin
    .from("company_settings")
    .select("support_email, email_notifications_enabled")
    .eq("id", 1)
    .maybeSingle()
  const supportEmail = settingsRow?.support_email?.trim()
  if (!settingsRow?.email_notifications_enabled || !supportEmail) return

  const moduleLabel = MODULE_LABELS[entityType]
  const recordUrl = dashboardRecordUrl(appBaseUrl(request), entityType, entityId)
  const { subject, html, text } = buildAdminNotificationEmail({ label, moduleLabel, scheduledDate, status, recordUrl, requestedDate, requestedTime })
  await sendEmail(supportEmail, subject, html, text)
}

// A Reschedule Requested notification now surfaces the customer's own
// proposed date/time when they gave one (see the
// reschedule_request_with_date migration) — pointing the admin at the
// queue's Reschedule Requests section to accept it, or the fallback line
// for the (still possible) case where they declined with no alternate
// date at all.
function buildAdminNotificationEmail({
  label,
  moduleLabel,
  scheduledDate,
  status,
  recordUrl,
  requestedDate,
  requestedTime,
}: {
  label: string
  moduleLabel: string
  scheduledDate: string
  status: "Confirmed" | "Reschedule Requested"
  recordUrl: string
  requestedDate?: string
  requestedTime?: string
}): { subject: string; html: string; text: string } {
  const isConfirmed = status === "Confirmed"
  const heading = isConfirmed ? "Customer Confirmed" : "Reschedule Requested"
  const subject = isConfirmed
    ? `${label} confirmed their ${moduleLabel} visit — ${scheduledDate}`
    : `${label} requested a reschedule — ${moduleLabel}`
  const requestedWhen = requestedDate ? `${requestedDate}${requestedTime ? ` at ${requestedTime}` : ""}` : null
  const bodyText = isConfirmed
    ? `They confirmed the scheduled date: ${scheduledDate}.`
    : requestedWhen
      ? `They declined the originally proposed date (${scheduledDate}) and requested a new one instead: ${requestedWhen}. Review and accept it from the Reschedule Requests section of the Pending Dispatch Approval queue, or edit Pre D directly on the record to propose a different date.`
      : `They declined the originally proposed date (${scheduledDate}), no alternate date was given, please follow up.`

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(heading)}</h2>
      <p style="margin:0 0 8px;color:#0f172a;"><strong>${escapeHtml(label)}</strong> — ${escapeHtml(moduleLabel)}</p>
      <p style="margin:0 0 24px;color:#475569;">${escapeHtml(bodyText)}</p>
      <a href="${recordUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">View in Dashboard</a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">If the button doesn't work, copy this link: ${recordUrl}</p>
    </div>
  `.trim()
  const text = `${heading}\n\n${label} — ${moduleLabel}\n${bodyText}\n\nView in dashboard: ${recordUrl}`
  return { subject, html, text }
}
