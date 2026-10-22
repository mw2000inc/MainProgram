"use client"

import * as React from "react"

// Registers the no-op service worker (public/sw.js) once on mount — this is
// what actually makes Chrome/Edge/Android consider the site installable.
// See sw.js's own comment for why it deliberately does no caching.
//
// Not in development (`next dev` on localhost:3000): a worker passing every
// request through itself got in the way of local sign-in and API calls, so
// none is registered there, and one left over from an earlier visit is
// unregistered. (Installability and Web Push are therefore only testable on
// a production build.)
export function RegisterServiceWorker() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {
          // Nothing to clean up, or the browser won't say — harmless either way.
        })
      return
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability just won't be offered — never worth surfacing to the
      // user or blocking anything else on the page.
    })
  }, [])
  return null
}
