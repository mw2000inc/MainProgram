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

// Every phone number this app actually has on file was typed by hand over
// time (customers.contact_number/contact_number2, no format ever
// enforced) — verified directly against live data before writing this:
// alongside the expected "09XXXXXXXXX" and bare "9XXXXXXXXX" shapes, real
// rows include ones with spaces ("0906 350 4878"), a name typed into the
// same field ("09754694987 - Michelle Gaston"), landlines ("02)9126175"),
// an extension ("9814311 local 41602 or 41604"), and at least one row
// that's an address, not a phone number at all. Stripping to digits-only
// and then requiring the result to be *exactly* a valid PH mobile shape
// (10 digits starting with 9, 11 starting with 09, or 12 starting with
// 639) handles the common "real number plus junk text" cases for free
// (the junk contributes no digits) while safely rejecting the landline/
// extension/address rows instead of guessing at a mangled destination —
// returns null for anything that doesn't confidently resolve.
export function toPhilippineE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (/^0?9\d{9}$/.test(digits)) return `+63${digits.slice(-10)}`
  if (/^639\d{9}$/.test(digits)) return `+${digits}`
  return null
}

// textbee (https://textbee.dev) — sends through an admin's own Android
// phone via its companion app, rather than a traditional SMS gateway.
// TEXTBEE_API_KEY is required (replaces the old SEMAPHORE_API_KEY —
// Semaphore is fully retired, not just superseded, see this function's own
// git history if the old implementation is ever needed for reference).
// Missing TEXTBEE_API_KEY is treated as "not configured yet" (status
// 'skipped_no_provider'), not an error — lets the rest of whichever flow
// called this still succeed before SMS credentials are added. An
// unrecognizable phone number (see toPhilippineE164 above) is a 'failed'
// result, not skipped — a real destination was expected and there wasn't
// one to send to.
//
// Character-set note (not a textbee-specific quirk — standard GSM/SMPP
// behavior any SMS transport follows, phone-network-level rather than
// provider-level): any character outside the GSM-7 alphabet — emoji being
// the most common way this bites a template — forces the *entire* message
// to UCS-2 encoding, dropping the per-segment limit from ~153 chars to
// ~67. Every SMS template calling this is deliberately plain ASCII (no
// emoji) specifically to stay on GSM-7 — worth re-checking this note if a
// template ever changes to include emoji, curly quotes, or other
// non-GSM-7 punctuation.
export async function sendSms(phone: string, message: string): Promise<ChannelResult> {
  const apiKey = process.env.TEXTBEE_API_KEY
  if (!apiKey) return { status: "skipped_no_provider", detail: "TEXTBEE_API_KEY is not set" }
  const recipient = toPhilippineE164(phone)
  if (!recipient) return { status: "failed", detail: `"${phone}" isn't a recognizable PH mobile number` }
  try {
    const response = await fetch("https://api.textbee.dev/api/v1/gateway/send-sms", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ recipients: [recipient], message }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      return { status: "failed", detail: typeof data === "object" ? JSON.stringify(data) : `HTTP ${response.status}` }
    }
    return { status: "sent" }
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : "Unknown error" }
  }
}
