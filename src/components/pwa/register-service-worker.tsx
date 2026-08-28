"use client"

import * as React from "react"

// Registers the no-op service worker (public/sw.js) once on mount — this is
// what actually makes Chrome/Edge/Android consider the site installable.
// See sw.js's own comment for why it deliberately does no caching.
export function RegisterServiceWorker() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability just won't be offered — never worth surfacing to the
      // user or blocking anything else on the page.
    })
  }, [])
  return null
}
