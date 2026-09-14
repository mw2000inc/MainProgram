// Server-only pieces shared by /api/dispatch/approve,
// /api/dispatch/accept-reschedule, and /api/dispatch/respond — the
// customer-notification sends (approve, accept-reschedule) and the
// admin-notification send (respond) all need the same module labels, the
// same technician/date-time lookups and formatting, the same Resend
// wrapper, and the same "which host actually served this request"
// base-URL logic, so this is the one place any of them has to change.
import { Resend } from "resend"
import type { SupabaseClient } from "@supabase/supabase-js"

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"

export const MODULE_LABELS: Record<DispatchEntityType, string> = {
  filter_change_plans: "Filter Change",
  install_plans: "Installation",
  collections: "Collection",
  repair_plans: "Repair",
}

// The friendly-tone message templates (in both /api/dispatch/approve and
// /api/dispatch/accept-reschedule) were written specifically around a
// Filter Change visit's exact scope — "water dispenser filter
// replacement, general cleaning, and Care Plan renewal" — so that phrase
// is used as-is only for that module; the other three get an equivalent
// plain description of what's actually happening, in the same warm
// wrapper.
export const MODULE_ACTION_PHRASES: Record<DispatchEntityType, string> = {
  filter_change_plans: "your water dispenser filter replacement, general cleaning, and Care Plan renewal",
  install_plans: "your water dispenser installation",
  collections: "your scheduled collection",
  repair_plans: "your repair service",
}

// Where an admin actually views/edits this record in the dashboard — same
// per-module ?id= routes the Daily Report's own row-click already uses
// (see daily-report-section.tsx), so a link built here always lands
// somewhere real.
const DASHBOARD_PATHS: Record<DispatchEntityType, string> = {
  filter_change_plans: "/filter-change",
  install_plans: "/install",
  collections: "/collection-plan",
  repair_plans: "/repair-plan",
}

export function dashboardRecordUrl(baseUrl: string, entityType: DispatchEntityType, entityId: string): string {
  return `${baseUrl}${DASHBOARD_PATHS[entityType]}?id=${entityId}`
}

export interface ChannelResult {
  status: "sent" | "failed" | "skipped_no_provider"
  detail?: string
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// All four dispatch tables now carry a plan-level technician column
// (filter_change_plans/collections/install_plans: serviceman, added by the
// 20260914000000 migration; repair_plans: th, from the original
// AppSheet-parity migration) — this can genuinely report one for any of
// them, not just Filter Change/Repair as before that migration. Moved here
// (previously private to /api/dispatch/approve/route.ts) so
// accept-reschedule's own confirmation email can show the same "Assigned
// Technician" line without duplicating the lookup.
export async function getEntityTechnician(
  admin: SupabaseClient,
  entityType: DispatchEntityType,
  entityId: string
): Promise<string | null> {
  if (entityType === "repair_plans") {
    const { data } = await admin.from("repair_plans").select("th").eq("id", entityId).maybeSingle()
    return (data as { th: string | null } | null)?.th || null
  }
  const { data } = await admin.from(entityType).select("serviceman").eq("id", entityId).maybeSingle()
  return (data as { serviceman: string | null } | null)?.serviceman || null
}

// requested_time is plain text in "HH:MM" (24-hour) form on every dispatch
// table — the literal value of an <input type="time"> from the customer's
// own reschedule request (see the reschedule_request_with_date migration).
// Only ever meaningful on a still-fresh Draft row if a prior
// Reschedule-Requested cycle left it behind; accept-reschedule reads its
// own copy straight from the RPC response instead of calling this.
export async function getEntityRequestedTime(
  admin: SupabaseClient,
  entityType: DispatchEntityType,
  entityId: string
): Promise<string | null> {
  const { data } = await admin.from(entityType).select("requested_time").eq("id", entityId).maybeSingle()
  return (data as { requested_time: string | null } | null)?.requested_time || null
}

// "yyyy-MM-dd" (a Postgres `date` column, always returned this shape by
// supabase-js) -> "MM/DD/YYYY", the format requested for customer-facing
// notifications. Plain string reformatting rather than a date-fns parse —
// a bare calendar date has no timezone to get wrong either way, so there's
// nothing a real Date object buys here.
export function formatUsDate(date: string): string {
  const parts = date.split("-")
  if (parts.length !== 3) return date
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

// "HH:MM" (24-hour, from the bare <input type="time"> above) -> "h:mm AM/PM".
// Also plain string math for the same reason formatUsDate is — no date to
// anchor a real Date/time-zone conversion to.
export function formatTimeLabel(time: string): string {
  const parts = time.split(":")
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  if (parts.length < 2 || Number.isNaN(hours) || Number.isNaN(minutes)) return time
  const period = hours >= 12 ? "PM" : "AM"
  const hours12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`
}

// Combines both into the "MM/DD/YYYY at h:mm AM/PM" phrasing used in push
// titles/bodies and email subject lines — falls back to the bare date when
// there's no time-of-day to show (the normal case for a first-time Draft
// approval, which has never had a customer-proposed time attached).
export function formatScheduleWhen(date: string, time?: string | null): string {
  const formattedDate = formatUsDate(date)
  return time ? `${formattedDate} at ${formatTimeLabel(time)}` : formattedDate
}

// The "Scheduled Date / Scheduled Time / Assigned Technician" summary block
// shared by both customer-facing confirmation emails (approve,
// accept-reschedule) — a labeled mini-table rather than the prose sentence
// each email already has, so the schedule itself is scannable at a glance
// on top of the friendly-tone paragraph. Any row without a real value
// (most commonly Scheduled Time, absent on a first-time Draft approval
// that's never had a customer-proposed time attached) is omitted entirely,
// same "don't show a blank line" precedent every other conditional line in
// these templates already follows.
export function buildScheduleSummary({
  scheduledDate,
  requestedTime,
  technician,
}: {
  scheduledDate: string | null
  requestedTime?: string | null
  technician: string | null
}): { html: string; textLines: string[] } {
  const rows: Array<{ label: string; value: string }> = []
  if (scheduledDate) rows.push({ label: "Scheduled Date", value: formatUsDate(scheduledDate) })
  if (requestedTime) rows.push({ label: "Scheduled Time", value: formatTimeLabel(requestedTime) })
  if (technician) rows.push({ label: "Assigned Technician", value: technician })

  if (rows.length === 0) return { html: "", textLines: [] }

  const html = `
    <div style="margin:0 0 16px;padding:12px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
      ${rows
        .map(
          (r) =>
            `<p style="margin:0 0 4px;color:#0f172a;font-size:14px;"><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.value)}</p>`
        )
        .join("\n      ")}
    </div>
  `.trim()
  const textLines = rows.map((r) => `${r.label}: ${r.value}`)
  return { html, textLines }
}

// Prefers the request's own origin (matches whatever host actually served
// this request — correct on any Vercel preview deploy too, not just
// production) and only falls back to the known production URL if that
// header is ever missing.
export function appBaseUrl(request: Request): string {
  const origin = request.headers.get("origin") ?? new URL(request.url).origin
  return origin || "https://mainprogram-neon.vercel.app"
}

// Resend (https://resend.com) — RESEND_API_KEY + RESEND_FROM_EMAIL
// required. Missing either is treated as "not configured yet" (status
// 'skipped_no_provider'), not an error, so the rest of whichever flow
// called this can still succeed (the DB transition, and — for approve —
// the SMS channel) before email credentials are added.
export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<ChannelResult> {
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

// SMS (previously textbee, and Semaphore before that) was fully removed as
// a notification channel — email (sendEmail above) is the only channel
// approve/accept-reschedule send now. sendSms()/toPhilippineE164() used to
// live here; see this file's own git history if that implementation is
// ever needed for reference. Historical dispatch_notifications rows with
// channel = 'sms', and the notify_phone columns on the four plan tables,
// are left exactly as they are — real audit history, not touched by this
// removal.
