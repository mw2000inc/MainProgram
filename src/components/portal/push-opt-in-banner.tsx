"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Mail } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { savePushSubscription, updateCustomerNotificationEmail } from "@/lib/api/push-subscriptions"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"

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

// `navigator.standalone` is a long-standing Safari-only, non-standard
// property (true once the site is launched from an "Add to Home Screen"
// icon) — not part of TypeScript's own DOM lib, hence the explicit cast
// rather than a plain `window.navigator.standalone` access.
function isIOSStandalone(): boolean {
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

// Combined email + Web Push opt-in for the read-only QR portal
// (customer-scan-view.tsx). Two independent capabilities share one panel:
// - Saving a notification email always works, regardless of browser/device
//   — it's a plain Supabase write, nothing push-specific about it.
// - Web Push itself only works where Notification/ServiceWorker/PushManager
//   actually exist. iOS Safari (outside of an installed/"Add to Home
//   Screen" PWA) has none of these APIs at all — rather than silently doing
//   nothing there, this shows the "Add to Home Screen" instructions instead
//   of a broken/absent Enable button, while the email field still works.
//
// Visible unless: this exact customer already dismissed it on this device
// (localStorage — there's no login here to attach a server-side flag to),
// or push is both supported AND already decided one way or the other
// (Notification.permission !== 'default') — in that specific case there's
// nothing left to ask, so the panel doesn't keep resurfacing forever. Every
// other case (support undecided, or push simply unavailable like iOS
// Safari) keeps the email-saving half of this panel available.
export function PushOptInBanner({ customerId, initialEmail }: { customerId: string; initialEmail: string }) {
  const { t } = useTranslation("portal")
  const queryClient = useQueryClient()
  const [visible, setVisible] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [email, setEmail] = React.useState(initialEmail)
  const [supportsPush, setSupportsPush] = React.useState(false)
  const [showIOSGuidance, setShowIOSGuidance] = React.useState(false)

  React.useEffect(() => {
    // Depends on window/Notification/localStorage, unavailable during SSR
    // — can't be a useState initializer, so this has to run as an effect
    // (same reasoning as install-prompt-context.tsx's own isStandalone() check).
    if (typeof window === "undefined") return
    const pushSupported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
    if (pushSupported && Notification.permission !== "default") return
    if (window.localStorage.getItem(dismissKey(customerId)) === "1") return
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupportsPush(pushSupported)
    setShowIOSGuidance(isIOS && !isIOSStandalone())
    setVisible(true)
  }, [customerId])

  async function handleSave() {
    setBusy(true)
    let emailSaveFailed = false
    const trimmedEmail = email.trim()
    if (trimmedEmail && trimmedEmail !== initialEmail) {
      try {
        await updateCustomerNotificationEmail(customerId, trimmedEmail)
        queryClient.invalidateQueries({ queryKey: ["portalProfile", customerId] })
      } catch {
        emailSaveFailed = true
      }
    }

    if (supportsPush) {
      try {
        const permission = await Notification.requestPermission()
        if (permission === "granted") {
          const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
          if (publicKey) {
            // RegisterServiceWorker (providers.tsx) already registers
            // /sw.js on every page load, including this one — `.ready`
            // just waits for whichever registration already happened
            // rather than registering a second time.
            const registration = await navigator.serviceWorker.ready
            const subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey),
            })
            const json = subscription.toJSON()
            if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
              await savePushSubscription(customerId, { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth })
            }
          }
        }
      } catch {
        // Never surface this half as an error — enabling push is a
        // nice-to-have on top of the email save, not something worth
        // alarming a customer over if a step fails.
      }
    }

    setBusy(false)
    setVisible(false)
    if (emailSaveFailed) toast.error(t("preferencesSaveFailed"))
    else toast.success(t("preferencesSaved"))
  }

  function handleDismiss() {
    window.localStorage.setItem(dismissKey(customerId), "1")
    setVisible(false)
  }

  if (!visible) return null

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-start gap-3">
          <Mail className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
          <div>
            <p className="text-sm font-medium">{t("emailConfirmHeading")}</p>
            <p className="text-sm text-muted-foreground">{t("emailConfirmSubtext")}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="portal-notify-email" className="text-xs text-muted-foreground">
            {t("notifyEmailLabel")}
          </Label>
          <Input
            id="portal-notify-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("notifyEmailPlaceholder")}
          />
        </div>

        {showIOSGuidance && (
          <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">{t("iosAddToHomeScreenGuidance")}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleDismiss} disabled={busy}>
            {t("pushOptInMaybeLater")}
          </Button>
          <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
            {supportsPush ? t("pushOptInEnable") : t("savePreferences")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
