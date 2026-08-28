import type { MetadataRoute } from "next"

// Web App Manifest — makes the existing MW2000 site installable (Chrome/Edge
// "Install", Android "Add to Home Screen"). Purely a manifest describing the
// already-existing site; it doesn't add a second app, backend, or database.
// Auto-served by Next.js at /manifest.webmanifest from this file's location
// (app/manifest.ts is a first-class file convention — see
// node_modules/next/dist/docs/.../metadata/manifest.md).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MW2000",
    short_name: "MW2000",
    description: "MW2000 Water Purification ERP",
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    // Matches --primary in globals.css (light theme) — the app's own brand blue.
    theme_color: "#0077B6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  }
}
