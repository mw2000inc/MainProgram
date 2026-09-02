import { supabase } from "@/lib/supabase/client"
import type { DispatchStatus } from "@/lib/types"

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"

export type DispatchChannelResult = { status: "sent" | "failed" | "skipped_no_provider"; detail?: string }

// Admin approval step — hits the server route (not the DB directly)
// because sending a real SMS/email needs the Semaphore/Resend API keys,
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
// flip an already-resolved row.
export async function respondToDispatchConfirmation(
  token: string,
  action: "confirm" | "reschedule"
): Promise<{ ok: boolean; status: DispatchStatus | null }> {
  const response = await fetch("/api/dispatch/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error ?? "Failed to respond to this confirmation")
  return { ok: data?.ok ?? false, status: data?.status ?? null }
}
