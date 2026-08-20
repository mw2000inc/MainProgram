"use client"

import * as React from "react"
import { QRCodeCanvas } from "qrcode.react"

// The one place that knows what a member's QR actually encodes — every scan
// entry point (the printable-card dialog, and the inline profile QR) reads
// through this so there's a single source of truth for the link, not a
// copy-pasted template literal in each place that renders one.
export function getScanUrl(customerId: string): string {
  // window.location.origin is a client-only external value, unavailable during SSR.
  if (typeof window === "undefined") return ""
  return `${window.location.origin}/scan/${customerId}`
}

// Shared QR rendering — same QRCodeCanvas configuration (error-correction
// level, quiet zone) used everywhere a member's QR appears, so the printable
// card and the inline profile QR are guaranteed to encode and render
// identically. `size` is the backing canvas resolution (kept high so
// PNG/PDF/print exports stay crisp); `style`/`className` control the
// on-screen display size independently.
export const CustomerQrCanvas = React.forwardRef<
  HTMLCanvasElement,
  {
    value: string
    size?: number
    style?: React.CSSProperties
  }
>(function CustomerQrCanvas({ value, size = 512, style }, ref) {
  // While the scan URL hasn't resolved yet (client-only, see getScanUrl
  // above), show a placeholder at the same footprint instead of rendering a
  // QR that encodes an empty value.
  if (!value) {
    return <div style={style ?? { width: size, height: size }} className="animate-pulse rounded bg-neutral-100" />
  }
  return <QRCodeCanvas ref={ref} value={value} size={size} level="M" marginSize={2} style={style} />
})
