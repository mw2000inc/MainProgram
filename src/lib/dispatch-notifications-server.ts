// Server-only pieces shared by /api/dispatch/approve and
// /api/dispatch/respond — the customer-notification send (approve) and
// the admin-notification send (respond) both need the same module labels,
// the same Resend wrapper, and the same "which host actually served this
// request" base-URL logic, so this is the one place either has to change.
import { Resend } from "resend"

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

// Semaphore SMS Gateway (https://semaphore.co) — PH-focused, REST API,
// form-encoded POST. SEMAPHORE_API_KEY is required; SEMAPHORE_SENDER_NAME
// is optional (Semaphore defaults to its own shared sender name if the
// account has no approved custom one). Missing SEMAPHORE_API_KEY is
// treated as "not configured yet" (status 'skipped_no_provider'), not an
// error — lets the rest of whichever flow called this still succeed
// before SMS credentials are added.
//
// Character-set note (not a Semaphore-specific quirk — this is standard
// GSM/SMPP behavior any SMS gateway follows): any character outside the
// GSM-7 alphabet — emoji being the most common way this bites a template
// — forces the *entire* message to UCS-2 encoding, dropping the
// per-segment limit from ~153 chars to ~67. Every SMS template calling
// this is deliberately plain ASCII (no emoji) specifically to stay on
// GSM-7 — worth re-checking this note if a template ever changes to
// include emoji, curly quotes, or other non-GSM-7 punctuation.
export async function sendSms(phone: string, message: string): Promise<ChannelResult> {
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
