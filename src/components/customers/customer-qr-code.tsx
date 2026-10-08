"use client"

import * as React from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/i18n-context"

// The one place that knows what a member's QR actually encodes — every scan
// entry point (the printable-card dialog, and the inline profile QR) reads
// through this so there's a single source of truth for the link, not a
// copy-pasted template literal in each place that renders one.
//
// `orderNumber` is optional — when given, the link deep-links into that one
// sale-list order on the customer's scan page (?order=...), for a per-row QR
// on the Related Sales_Lists panel. Omitted, it's the plain per-customer scan
// link exactly as before — this is purely additive.
export function getScanUrl(customerId: string, orderNumber?: string): string {
  // window.location.origin is a client-only external value, unavailable during SSR.
  if (typeof window === "undefined") return ""
  const base = `${window.location.origin}/scan/${customerId}`
  return orderNumber ? `${base}?order=${encodeURIComponent(orderNumber)}` : base
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

// Which member's scan page an order's QR opens: its own customer link, or —
// for an order with no customer_id — the member whose order number it is.
// The same rule the public scan page (get_portal_profile) and the Member
// page use to list a member's orders, so every view resolves an order to the
// same member and therefore encodes the identical link.
export function orderScanCustomerId(
  entry: { customerId?: string; orderNumber: string },
  customers: { id: string; orderNumber: string }[]
): string | undefined {
  if (entry.customerId) return entry.customerId
  const order = entry.orderNumber.trim()
  return order ? customers.find((c) => c.orderNumber.trim() === order)?.id : undefined
}

// One order's QR, shown on its detail views (the Member page's order detail,
// the Sale List detail panel and the full order page): the per-order scan
// link (getScanUrl with ?order=), so scanning opens that member's public page
// on this order. The order number is printed under it, with a PNG download
// for printing. An order with no resolvable member (or no order number) shows
// a short note instead of a QR that would open nothing.
export function OrderQrCode({ customerId, orderNumber }: { customerId?: string; orderNumber: string }) {
  const { t } = useTranslation("member")
  const order = (orderNumber ?? "").trim()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  // Client-only (window.location.origin), resolved after mount like the
  // member QR, so the server and first client render agree.
  const [scanUrl, setScanUrl] = React.useState("")
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScanUrl(customerId && order ? getScanUrl(customerId, order) : "")
  }, [customerId, order])

  if (!customerId || !order) {
    return (
      <p className="max-w-[11rem] text-right text-xs text-muted-foreground" data-testid="order-qr-unavailable">
        {t("orderQrUnavailable")}
      </p>
    )
  }

  function download() {
    const dataUrl = canvasRef.current?.toDataURL("image/png")
    if (!dataUrl) return
    const a = document.createElement("a")
    a.href = dataUrl
    a.download = `${order.replace(/[^\w-]+/g, "_")}-qr.png`
    a.click()
  }

  return (
    <div className="flex w-fit flex-col items-center gap-0.5" data-testid="order-qr" data-scan-url={scanUrl}>
      <div className="rounded-md border bg-white p-1">
        <CustomerQrCanvas ref={canvasRef} value={scanUrl} size={256} style={{ width: 64, height: 64 }} />
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] font-medium leading-tight">{order}</span>
        <Button type="button" variant="ghost" size="sm" className="h-5 gap-0.5 px-1 text-[11px]" onClick={download} disabled={!scanUrl} title={t("downloadQr")}>
          <Download className="h-3 w-3" /> {t("orderQrDownload")}
        </Button>
      </div>
    </div>
  )
}
