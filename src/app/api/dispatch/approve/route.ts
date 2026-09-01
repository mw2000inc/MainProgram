import { NextResponse } from "next/server"
import { Resend } from "resend"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"

const MODULE_LABELS: Record<DispatchEntityType, string> = {
  filter_change_plans: "Filter Change",
  install_plans: "Installation",
  collections: "Collection",
  repair_plans: "Repair",
}

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
  const { out_token: token, out_label: label, out_scheduled_date: scheduledDate } = row

  const admin = createAdminClient()
  const [{ data: settingsRow }, address] = await Promise.all([
    admin.from("company_settings").select("company_name").eq("id", 1).maybeSingle(),
    getEntityAddress(admin, entityType, entityId),
  ])
  const companyName = settingsRow?.company_name || "MW2000"
  const moduleLabel = MODULE_LABELS[entityType]
  const confirmUrl = `${appBaseUrl(request)}/confirm/${token}`

  const result: { sms?: ChannelResult; email?: ChannelResult } = {}

  if (notifyPhone) {
    const message = buildSmsMessage({ companyName, moduleLabel, scheduledDate: scheduledDate ?? "", address, confirmUrl })
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
    const { subject, html, text } = buildEmailContent({ companyName, moduleLabel, label: label ?? "", scheduledDate: scheduledDate ?? "", address, confirmUrl })
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

interface ChannelResult {
  status: "sent" | "failed" | "skipped_no_provider"
  detail?: string
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

function buildSmsMessage({
  companyName,
  moduleLabel,
  scheduledDate,
  address,
  confirmUrl,
}: {
  companyName: string
  moduleLabel: string
  scheduledDate: string
  address: string | null
  confirmUrl: string
}): string {
  const location = address ? ` at ${address}` : ""
  return `${companyName}: Your ${moduleLabel} is scheduled for ${scheduledDate}${location}. Please confirm or request a reschedule here: ${confirmUrl}`
}

function buildEmailContent({
  companyName,
  moduleLabel,
  label,
  scheduledDate,
  address,
  confirmUrl,
}: {
  companyName: string
  moduleLabel: string
  label: string
  scheduledDate: string
  address: string | null
  confirmUrl: string
}): { subject: string; html: string; text: string } {
  const subject = `${companyName}: Your ${moduleLabel} is scheduled for ${scheduledDate}`
  const addressLine = address ? `<p style="margin:0 0 16px;color:#475569;">Location: ${escapeHtml(address)}</p>` : ""
  const addressLineText = address ? `Location: ${address}\n` : ""
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="margin:0 0 16px;color:#0f172a;">${escapeHtml(companyName)}</h2>
      <p style="margin:0 0 8px;color:#0f172a;">Hi ${escapeHtml(label)},</p>
      <p style="margin:0 0 16px;color:#0f172a;">Your <strong>${escapeHtml(moduleLabel)}</strong> is scheduled for <strong>${escapeHtml(scheduledDate)}</strong>.</p>
      ${addressLine}
      <p style="margin:0 0 24px;color:#475569;">Please confirm this date, or let us know if you need to reschedule.</p>
      <a href="${confirmUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Confirm or Reschedule</a>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">If the button doesn't work, copy this link: ${confirmUrl}</p>
    </div>
  `.trim()
  const text = `${companyName}\n\nHi ${label},\n\nYour ${moduleLabel} is scheduled for ${scheduledDate}.\n${addressLineText}\nPlease confirm or request a reschedule here: ${confirmUrl}`
  return { subject, html, text }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// Prefers the request's own origin (matches whatever host actually served
// this request — correct on any Vercel preview deploy too, not just
// production) and only falls back to the known production URL if that
// header is ever missing.
function appBaseUrl(request: Request): string {
  const origin = request.headers.get("origin") ?? new URL(request.url).origin
  return origin || "https://mainprogram-neon.vercel.app"
}

// Semaphore SMS Gateway (https://semaphore.co) — PH-focused, REST API,
// form-encoded POST. SEMAPHORE_API_KEY is required; SEMAPHORE_SENDER_NAME
// is optional (Semaphore defaults to its own shared sender name if the
// account has no approved custom one). Missing SEMAPHORE_API_KEY is
// treated as "not configured yet" (status 'skipped_no_provider'), not an
// error — lets the rest of the approval flow (the DB transition, and the
// email channel) succeed even before SMS credentials are added.
async function sendSms(phone: string, message: string): Promise<ChannelResult> {
  const apiKey = process.env.SEMAPHORE_API_KEY
  if (!apiKey) return { status: "skipped_no_provider", detail: "SEMAPHORE_API_KEY is not set" }
  try {
    const params = new URLSearchParams({ apikey: apiKey, number: phone, message })
    const senderName = process.env.SEMAPHORE_SENDER_NAME
    if (senderName) params.set("sendername", senderName)
    const response = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body: params })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return { status: "failed", detail: typeof data === "object" ? JSON.stringify(data) : `HTTP ${response.status}` }
    }
    const first = Array.isArray(data) ? data[0] : data
    if (!first?.message_id) {
      return { status: "failed", detail: "Semaphore response had no message_id" }
    }
    return { status: "sent" }
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : "Unknown error" }
  }
}

// Resend (https://resend.com) — RESEND_API_KEY + RESEND_FROM_EMAIL
// required. Same "not configured yet" treatment as sendSms above.
async function sendEmail(to: string, subject: string, html: string, text: string): Promise<ChannelResult> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !from) return { status: "skipped_no_provider", detail: "RESEND_API_KEY/RESEND_FROM_EMAIL not set" }
  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({ from, to, subject, html, text })
    if (error) return { status: "failed", detail: error.message }
    return { status: "sent" }
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : "Unknown error" }
  }
}
