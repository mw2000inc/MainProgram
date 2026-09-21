import { supabase } from "@/lib/supabase/client"
import { wrapSupabaseError } from "@/lib/supabase/errors"
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
// because sending a real email needs the Resend API key, which only ever
// lives server-side (see src/app/api/dispatch/approve/route.ts). That
// route re-checks admin-ness itself (via approve_dispatch_item(), under
// the caller's own session), generates the confirmation token, moves the
// row to 'Pending Customer Confirmation', sends to the provided email, and
// logs the real outcome to dispatch_notifications — 'sent' or 'failed'
// from Resend's own response, or 'skipped_no_provider' if RESEND_API_KEY
// isn't configured yet. SMS was fully removed as a notification channel —
// see dispatch-notifications-server.ts's own note.
export async function approveDispatchItem(input: {
  entityType: DispatchEntityType
  entityId: string
  notifyEmail: string
}): Promise<{ token: string; confirmUrl: string; email?: DispatchChannelResult } | null> {
  const response = await fetch("/api/dispatch/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entityType: input.entityType,
      entityId: input.entityId,
      notifyEmail: input.notifyEmail,
    }),
  })
  if (response.status === 409) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to approve this dispatch item")
  return data
}

// Admin-only "Confirm without notifying" — Draft straight to Confirmed, no
// email, no push, no confirmation token/link, no customer round-trip at
// all. Deliberately does NOT go through approveDispatchItem/its route (that
// path always ends in a real send, and only ever reaches 'Pending Customer
// Confirmation'). A plain status update is safe here: the only trigger
// reacting to dispatch changes fires on pre_d edits, not status edits, and
// schedule_jobs creation on confirm lives inside the customer-confirm RPCs
// (respond_to_dispatch_confirmation / accept_requested_reschedule), not a
// table trigger — so this doesn't spawn Schedule-panel jobs either.
//
// Runs under the caller's own session (RLS *_update_admin), so the audit
// trail attributes it to them — a service-role script would attribute it to
// nobody. Every update is guarded with .eq("dispatch_status", "Draft"), so
// a row that already moved (approved, rejected, rescheduled) between the
// admin opening the dialog and confirming is left alone rather than
// clobbered; the returned counts are what was ACTUALLY changed, per table.
// Chunked because .in("id", ...) puts every id in the request URL.
const CONFIRM_CHUNK_SIZE = 40

export async function confirmDispatchItemsWithoutNotifying(
  items: { entityType: DispatchEntityType; entityId: string }[]
): Promise<Record<DispatchEntityType, number>> {
  const updated: Record<DispatchEntityType, number> = {
    filter_change_plans: 0,
    install_plans: 0,
    collections: 0,
    repair_plans: 0,
  }
  const idsByType = new Map<DispatchEntityType, string[]>()
  for (const item of items) {
    const ids = idsByType.get(item.entityType)
    if (ids) ids.push(item.entityId)
    else idsByType.set(item.entityType, [item.entityId])
  }
  for (const [entityType, ids] of idsByType) {
    for (let i = 0; i < ids.length; i += CONFIRM_CHUNK_SIZE) {
      const { data, error } = await supabase
        .from(entityType)
        .update({ dispatch_status: "Confirmed" })
        .in("id", ids.slice(i, i + CONFIRM_CHUNK_SIZE))
        .eq("dispatch_status", "Draft")
        .select("id")
      if (error) throw wrapSupabaseError(error)
      updated[entityType] += data?.length ?? 0
    }
  }
  return updated
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
// confirmed" notification using the email already on the row from the
// original approval, same shared send mechanism as approveDispatchItem.
export async function acceptRequestedReschedule(input: {
  entityType: DispatchEntityType
  entityId: string
}): Promise<{ email?: DispatchChannelResult } | null> {
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

// Admin's outright decline on a Pending Approvals item — see
// reject_dispatch_item() and /api/dispatch/reject/route.ts. Valid from
// Draft, Pending Customer Confirmation, or Reschedule Requested; never from
// an already-Confirmed or already-Rejected row (409, same "no longer
// actionable" convention as approve/accept above).
export async function rejectDispatchItem(input: {
  entityType: DispatchEntityType
  entityId: string
  reason?: string
}): Promise<{ email?: DispatchChannelResult } | null> {
  const response = await fetch("/api/dispatch/reject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType: input.entityType, entityId: input.entityId, reason: input.reason }),
  })
  if (response.status === 409) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to reject this dispatch item")
  return data
}

// Admin-initiated "actually, let's find a different date" — see
// request_reschedule_by_admin() and /api/dispatch/request-reschedule/route.ts.
// Only valid from Draft or Pending Customer Confirmation (not from an
// already Reschedule Requested/Confirmed/Rejected row).
export async function requestRescheduleByAdmin(input: {
  entityType: DispatchEntityType
  entityId: string
  reason: string
}): Promise<{ email?: DispatchChannelResult } | null> {
  const response = await fetch("/api/dispatch/request-reschedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType: input.entityType, entityId: input.entityId, reason: input.reason }),
  })
  if (response.status === 409) return null
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to request a reschedule for this item")
  return data
}
