"use client"

import * as React from "react"
import { Bell } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { savePushSubscription } from "@/lib/api/push-subscriptions"
import { useTranslation } from "@/lib/i18n/i18n-context"

function dismissKey(customerId: string): string {
  return `push-optin-dismissed-${customerId}`
}

// pushManager.subscribe() needs the VAPID public key as a raw Uint8Array
// backed by a real ArrayBuffer (not the base64url string it's stored/
// transmitted as everywhere else) — this is the standard conversion every
// Web Push guide uses, nothing app-specific about it. Explicitly allocating
// the ArrayBuffer first (rather than `new Uint8Array(length)`) satisfies
// TypeScript's stricter ArrayBufferView<ArrayBuffer> typing for
// applicationServerKey — plain `new Uint8Array(length)` types its own
// .buffer as the broader ArrayBufferLike, which subscribe()'s signature
// no longer accepts.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// Non-intrusive push opt-in prompt for the read-only QR portal
// (customer-scan-view.tsx). Never renders at all unless every precondition
// actually holds: the browser supports Notification/ServiceWorker/
// PushManager, permission hasn't already been decided one way or the other
// (Notification.permission === 'default'), and this exact customer hasn't
// already dismissed it on this device (localStorage, not a server flag --
// there's no login here to attach one to). "Maybe Later" just closes it for
// this device; there's deliberately no server-side "never ask again" state.
export function PushOptInBanner({ customerId }: { customerId: string }) {
  const { t } = useTranslation("portal")
  const [visible, setVisible] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    // Depends on window/Notification/localStorage, unavailable during SSR
    // — can't be a useState initializer, so this has to run as an effect
    // (same reasoning as install-prompt-context.tsx's own isStandalone() check).
    if (typeof window === "undefined") return
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return
    if (Notification.permission !== "default") return
    if (window.localStorage.getItem(dismissKey(customerId)) === "1") return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
  }, [customerId])

  async function handleEnable() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") return

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) return

      // RegisterServiceWorker (providers.tsx) already registers /sw.js on
      // every page load, including this one — `.ready` just waits for
      // whichever registration already happened rather than registering a
      // second time.
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return

      await savePushSubscription(customerId, { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
    } catch {
      // Never surface this as an error — enabling push is a nice-to-have,
      // not something worth alarming a customer over if a step fails.
    } finally {
      setBusy(false)
      setVisible(false)
    }
  }

  function handleDismiss() {
    window.localStorage.setItem(dismissKey(customerId), "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Bell className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <p className="text-sm">{t("pushOptInPrompt")}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleDismiss} disabled={busy}>
            {t("pushOptInMaybeLater")}
          </Button>
          <Button type="button" size="sm" onClick={handleEnable} disabled={busy}>
            {t("pushOptInEnable")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
