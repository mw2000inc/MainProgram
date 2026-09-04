import { supabase } from "@/lib/supabase/client"
import type { DispatchStatus } from "@/lib/types"

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"

export type DispatchChannelResult = { status: "sent" | "failed" | "skipped_no_provider"; detail?: string }

// One row per actual send attempt (see the dispatch_dual_channel_
// notifications migration) — both approveDispatchItem and
// acceptRequestedReschedule log into this same table the same way, so a
// row here doesn't distinguish "initial approval" from "reschedule
// confirmation"; DispatchHistoryDialog groups by timing to tell those
// apart rather than needing a new column for it.
export interface DispatchNotificationRecord {
  id: string
  entityType: DispatchEntityType
  entityId: string
  channel: "sms" | "email"
  recipient: string
  status: "sent" | "failed" | "skipped_no_provider"
  createdAt: string
  createdBy?: string
}

type DispatchNotificationRow = {
  id: string
  entity_type: DispatchEntityType
  entity_id: string
  channel: "sms" | "email"
  recipient: string
  status: "sent" | "failed" | "skipped_no_provider"
  created_at: string
  created_by: string | null
}

// Admin-only per RLS (dispatch_notifications_select_admin) — every past
// send attempt across all four modules, newest first. Small enough today
// (low double digits) that this reads the whole table rather than paging;
// revisit if that stops being true.
export async function listDispatchNotifications(): Promise<DispatchNotificationRecord[]> {
  const { data, error } = await supabase
    .from("dispatch_notifications")
    .select("id, entity_type, entity_id, channel, recipient, status, created_at, created_by")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data as DispatchNotificationRow[]).map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    channel: row.channel,
    recipient: row.recipient,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
  }))
}

// Admin approval step — hits the server route (not the DB directly)
// because sending a real SMS/email needs the textbee/Resend API keys,
// which only ever live server-side (see
// src/app/api/dispatch/approve/route.ts). That route re-checks
// admin-ness itself (via approve_dispatch_item(), under the caller's own
// session), generates the confirmation token, moves the row to 'Pending
// Customer Confirmation', sends whichever of phone/email is provided, and
// logs each channel's real outcome to dispatch_notifications — 'sent' or
// 'failed' from the provider's own response, or 'skipped_no_provider' if
// that channel's API key isn't configured yet.
export async function approveDispatchItem(input: {
  entityType: DispatchEntityType
  entityId: string
  notifyPhone?: string
  notifyEmail?: string
}): Promise<{ token: string; confirmUrl: string; sms?: DispatchChannelResult; email?: DispatchChannelResult } | null> {
  const response = await fetch("/api/dispatch/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityType: input.entityType,
      entityId: input.entityId,
      notifyPhone: input.notifyPhone,
      notifyEmail: input.notifyEmail,
    }),
  })
  if (response.status === 409) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to approve this dispatch item")
  return data
}

export interface DispatchConfirmationDetails {
  entityType: DispatchEntityType
  label: string
  scheduledDate: string
  status: DispatchStatus
  valid: boolean
}

// Public, unauthenticated lookup by token — the customer is never logged
// in. Reads through get_dispatch_confirmation_details(), a SECURITY
// DEFINER RPC granted to the anon role, same "narrow RPC instead of
// loosening RLS" pattern the customer portal's get_portal_profile() uses.
export async function getDispatchConfirmationDetails(token: string): Promise<DispatchConfirmationDetails | null> {
  const { data, error } = await supabase.rpc("get_dispatch_confirmation_details", { p_token: token })
  if (error) throw error
  const row = (
    data as {
      out_entity_type: DispatchEntityType
      out_label: string
      out_scheduled_date: string
      out_status: DispatchStatus
      out_valid: boolean
    }[]
  )?.[0]
  if (!row) return null
  return {
    entityType: row.out_entity_type,
    label: row.out_label,
    scheduledDate: row.out_scheduled_date,
    status: row.out_status,
    valid: row.out_valid,
  }
}

// Public, unauthenticated action — 'confirm' or 'reschedule'. Hits the
// server route (not the DB directly) so a successful response can also
// email the admin (see src/app/api/dispatch/respond/route.ts) — the
// actual authorization is unchanged: respond_to_dispatch_confirmation()
// only ever succeeds against a row that's actually 'Pending Customer
// Confirmation' with a non-expired token, so this can't be replayed to
// flip an already-resolved row. requestedDate/requestedTime are only
// meaningful for 'reschedule' — the customer's own proposed replacement,
// which an admin reviews and accepts separately (see
// acceptRequestedReschedule below); time is a courtesy display detail
// only, never applied to the real schedule.
export async function respondToDispatchConfirmation(
  token: string,
  action: "confirm" | "reschedule",
  requestedDate?: string,
  requestedTime?: string
): Promise<{ ok: boolean; status: DispatchStatus | null }> {
  const response = await fetch("/api/dispatch/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action, requestedDate, requestedTime }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to respond to this confirmation")
  return { ok: data?.ok ?? false, status: data?.status ?? null }
}

// Admin action from the Pending Dispatch Approval queue's Reschedule
// Requests section — accepts the customer's own proposed date, applying
// it straight to the real schedule field and jumping directly to
// 'Confirmed' (see accept_requested_reschedule() — no second customer
// click needed, they already told us this date works). Sends a "you're
// confirmed" notification using the phone/email already on the row from
// the original approval, same shared send mechanism as approveDispatchItem.
export async function acceptRequestedReschedule(input: {
  entityType: DispatchEntityType
  entityId: string
}): Promise<{ sms?: DispatchChannelResult; email?: DispatchChannelResult } | null> {
  const response = await fetch("/api/dispatch/accept-reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType: input.entityType, entityId: input.entityId }),
  })
  if (response.status === 409) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to accept this requested reschedule")
  return data
}
