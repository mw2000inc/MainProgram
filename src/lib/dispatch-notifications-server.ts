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
