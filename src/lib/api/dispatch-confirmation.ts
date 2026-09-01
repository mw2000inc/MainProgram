import { supabase } from "@/lib/supabase/client"
import type { DispatchStatus } from "@/lib/types"

export type DispatchEntityType = "filter_change_plans" | "install_plans" | "collections" | "repair_plans"

// Admin approval step (see the dispatch_confirmation_workflow migration's
// approve_dispatch_item()) — re-checks admin-ness server-side (not just at
// this call site), generates the confirmation token, moves the row to
// 'Pending Customer Confirmation', and logs the stub notification (no real
// SMS/Email provider is wired up yet — see dispatch_notifications).
export async function approveDispatchItem(input: {
  entityType: DispatchEntityType
  entityId: string
  notifyContact: string
  channel: "sms" | "email"
}): Promise<{ token: string; message: string } | null> {
  const { data, error } = await supabase.rpc("approve_dispatch_item", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_notify_contact: input.notifyContact,
    p_channel: input.channel,
    p_confirm_base_url: window.location.origin,
  })
  if (error) throw error
  const row = (data as { out_token: string | null; out_message: string | null }[])?.[0]
  if (!row?.out_token) return null
  return { token: row.out_token, message: row.out_message ?? "" }
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

// Public, unauthenticated action — 'confirm' or 'reschedule'. See
// respond_to_dispatch_confirmation(): only ever succeeds against a row
// that's actually 'Pending Customer Confirmation' with a non-expired
// token, so this can't be replayed to flip an already-resolved row.
export async function respondToDispatchConfirmation(
  token: string,
  action: "confirm" | "reschedule"
): Promise<{ ok: boolean; status: DispatchStatus | null }> {
  const { data, error } = await supabase.rpc("respond_to_dispatch_confirmation", { p_token: token, p_action: action })
  if (error) throw error
  const row = (data as { out_ok: boolean; out_status: DispatchStatus | null }[])?.[0]
  return { ok: row?.out_ok ?? false, status: row?.out_status ?? null }
}
