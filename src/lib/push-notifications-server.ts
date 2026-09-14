import "server-only"
import webpush from "web-push"
import type { SupabaseClient } from "@supabase/supabase-js"

// Configures the VAPID identity once per server instance rather than per
// call — web-push's own setVapidDetails() is cheap but there's no reason to
// repeat it. The mailto: subject is required by the Web Push protocol (push
// services use it to contact the sender if a key is misbehaving); it isn't
// shown to the customer anywhere.
let vapidConfigured = false
function ensureVapidConfigured() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return
  webpush.setVapidDetails("mailto:marketing@mw2000inc.com", publicKey, privateKey)
  vapidConfigured = true
}

export interface PushPayload {
  title: string
  body: string
  url: string
}

interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

// Best-effort, never throws — a push failure should never be allowed to
// break the real action it's attached to (the schedule approval itself),
// same principle the email send already follows in
// /api/dispatch/approve/route.ts. Silently does nothing if VAPID keys
// aren't configured (mirrors sendEmail()'s own "skipped_no_provider"
// reasoning) rather than logging noisy errors for an intentionally-unset
// local/dev environment. Returns how many subscriptions were actually
// attempted (0 if VAPID isn't configured or the customer has none) — not a
// delivery guarantee, just enough for a caller like the schedule-reminders
// cron to tell "we had somewhere to send this" from "we had nothing at
// all," the same way sendEmail()'s ChannelResult already does for email.
export async function sendPushToCustomer(admin: SupabaseClient, customerId: string, payload: PushPayload): Promise<number> {
  ensureVapidConfigured()
  if (!vapidConfigured) return 0

  const { data } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("customer_id", customerId)
  const subscriptions = (data ?? []) as SubscriptionRow[]
  if (subscriptions.length === 0) return 0

  const body = JSON.stringify(payload)
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
      } catch (err) {
        // 404/410 means the browser/push service has permanently discarded
        // this subscription (uninstalled, permission revoked, etc.) — prune
        // it so future sends don't keep retrying a dead endpoint. Any other
        // error (network blip, momentary provider issue) is left alone;
        // it'll just be tried again next time.
        const statusCode = (err as { statusCode?: number } | null)?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id)
        }
      }
    })
  )
  return subscriptions.length
}
