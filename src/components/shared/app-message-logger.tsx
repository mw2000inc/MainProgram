"use client"

import * as React from "react"
import { toast } from "sonner"
import { useAuth } from "@/lib/auth/auth-context"

// Warning and error pop-ups are also saved to the bell (all admins see them,
// named with who saw them — /api/notifications/app-message), so they stay
// after the pop-up fades. Wraps sonner's toast.warning / toast.error once for
// the whole app; only text messages are saved, and only while signed in.
// Inline warnings that aren't pop-ups call logAppMessage themselves.

let signedIn = false

// href: where clicking it in the bell goes — the page it happened on (with
// its ?date= etc.) unless the caller names a more exact place (e.g. the
// Filter Change it's about).
export function logAppMessage(level: "warning" | "error", message: string, detail?: string, href?: string) {
  const text = [message, detail].filter((s) => typeof s === "string" && s.trim()).join(" — ").trim()
  if (!signedIn || !text) return
  const where = href ?? `${window.location.pathname}${window.location.search}`
  fetch("/api/notifications/app-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, message: text, href: where }),
  }).catch(() => {
    // Not saved — the pop-up itself still showed.
  })
}

type ToastFn = typeof toast.error
let patched = false
function patchToasts() {
  if (patched) return
  patched = true
  for (const level of ["warning", "error"] as const) {
    const original: ToastFn = toast[level].bind(toast)
    toast[level] = ((message, data) => {
      const id = original(message, data)
      const detail = typeof data?.description === "string" ? data.description : undefined
      if (typeof message === "string") logAppMessage(level, message, detail)
      return id
    }) as ToastFn
  }
}

export function AppMessageLogger() {
  const { user } = useAuth()
  React.useEffect(() => {
    signedIn = !!user
  }, [user])
  React.useEffect(() => {
    patchToasts()
  }, [])
  return null
}
