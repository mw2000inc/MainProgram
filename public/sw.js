// MW2000 PWA service worker.
//
// Two jobs: satisfy installability (Chrome/Edge's install criteria,
// Android's "Add to Home Screen") and receive real Web Push notifications
// for the customer portal's opt-in banner (see push-opt-in-banner.tsx).
// Everything else is unchanged from the original install-only version — it
// deliberately does NO caching of any kind:
//   - No Cache Storage usage at all — every request (including this app's
//     own pages/scripts and every Supabase call) goes straight to the
//     network exactly as it does without this file.
//   - Nothing here can ever serve stale/offline data, make a write look
//     like it succeeded while offline, or leak one signed-in user's
//     cached ERP data to a different user on the same device.
// If real offline support is ever wanted, that's a deliberate, separate
// feature decision — not something to bolt on quietly inside this file.

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

// A no-op passthrough — some browsers' installability checks look for a
// registered fetch handler, but this one never intercepts the response;
// it just lets the request go to the network as normal.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request))
})

// Real Web Push support (customer portal opt-in, see
// push-opt-in-banner.tsx / push-notifications-server.ts) — the only two
// listeners added on top of the install/activate/fetch no-ops above. The
// push event's payload is plain JSON: {title, body, url}, sent as-is by the
// server (see sendPushToCustomer). Falls back to generic text if the
// payload is somehow missing/malformed, since showNotification() is
// required to actually show *something* whenever a push event fires.
self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || "MW2000"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "You have a new update.",
      icon: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    })
  )
})

// Focuses an already-open tab on the target URL if one exists, otherwise
// opens a new one — standard notificationclick pattern, not specific to
// this app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
