import { supabase } from "@/lib/supabase/client"

// Reached anonymously from the QR portal (no session) — same
// security-definer RPC pattern getPortalProfile() already uses, scoped to
// exactly the customer_id the QR code encodes rather than relying on RLS.
export async function savePushSubscription(
  customerId: string,
  subscription: { endpoint: string; p256dh: string; auth: string }
): Promise<void> {
  const { error } = await supabase.rpc("save_push_subscription", {
    p_customer_id: customerId,
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
  })
  if (error) throw error
}
