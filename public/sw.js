// MW2000 PWA service worker.
//
// This exists ONLY to satisfy installability (Chrome/Edge's install
// criteria, and Android's "Add to Home Screen") and to let the installed
// app open in its own standalone window. It deliberately does NO caching
// of any kind:
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
