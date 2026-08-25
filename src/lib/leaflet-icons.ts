import type L from "leaflet"

// A small colored teardrop pin built as an inline-SVG divIcon, so map
// components never need Leaflet's default marker image assets (marker-icon.png
// etc.) — importing those reliably through webpack/Next.js is a well-known
// pain point, and a plain divIcon sidesteps it entirely.
export function makePinIcon(leaflet: typeof L, color: string) {
  return leaflet.divIcon({
    className: "",
    html: `<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 0C5.8 0 0 5.8 0 13c0 9.75 13 23 13 23s13-13.25 13-23c0-7.2-5.8-13-13-13z" fill="${color}"/>
      <circle cx="13" cy="13" r="5.5" fill="#ffffff"/>
    </svg>`,
    iconSize: [26, 36],
    iconAnchor: [13, 36],
    popupAnchor: [0, -32],
  })
}
