"use client"

import * as React from "react"
import { Copy, Download, Printer, FileText } from "lucide-react"
import { CustomerQrCanvas, getScanUrl } from "@/components/customers/customer-qr-code"
import jsPDF from "jspdf"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { Customer } from "@/lib/types"

// Physical card spec from the printable-card design: a single 4.5cm x 3cm
// landscape card. Everything below is derived from these so the on-screen
// preview, PNG, PDF and browser print all come out the same true size.
const CARD_W_CM = 4.5
const CARD_H_CM = 3
const QR_CM = 2.2
const PAD_CM = 0.2

// Card color scheme: plain white card, no background fill and no border. The QR
// is black-on-white (qrcode.react renders its own white quiet-zone). The small
// label is a muted gray so the bold navy value is the clear focal point next
// to it, matching the reference card layout.
const CARD_BG = "#ffffff"
const LABEL_COLOR = "#6b7280"
const VALUE_COLOR = "#0f1729"

export function CustomerQrDialog({
  open,
  onOpenChange,
  customer,
  // When given, this is a per-order QR for one of the customer's
  // sale_list_entries rows (see MemberRelatedSalesTable) — the printed card
  // shows "ORDER #" + this order number instead of the member's own account
  // number, and the encoded link deep-links into that order on the scan
  // page. Omitted, this is the member-level QR: "MEMBER ACCOUNT #" + the
  // customer's own member_account_number, plain (non-deep-linked) scan link.
  orderNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer
  orderNumber?: string
}) {
  const isOrderCard = orderNumber !== undefined
  const displayLabel = isOrderCard ? "Order #" : "Member Account #"
  const displayValue = isOrderCard ? orderNumber : customer.memberAccountNumber
  const qrCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const [scanUrl, setScanUrl] = React.useState("")

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScanUrl(getScanUrl(customer.id, orderNumber))
    }
  }, [open, customer.id, orderNumber])

  // The QR is rendered directly in the preview (see below) rather than snapshotted
  // asynchronously — so the exports just read that same already-painted canvas at
  // click time via its ref. Reading at click time is reliable (the canvas has long
  // since painted by the time a button is pressed), which is why there's no
  // qrDataUrl state or effect-based snapshot anymore (that race left the preview
  // stuck on its loading placeholder in production).
  function currentQrDataUrl(): string {
    return qrCanvasRef.current?.toDataURL("image/png") || ""
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(scanUrl)
    toast.success("Scan link copied")
  }

  // --- PNG: compose the single card onto one canvas at ~300 DPI ---
  async function handleDownloadPng() {
    const dataUrl = currentQrDataUrl()
    if (!dataUrl) return
    const PX_PER_CM = 118.11 // ~300 DPI
    const margin = 0.2 * PX_PER_CM
    const cardW = CARD_W_CM * PX_PER_CM
    const cardH = CARD_H_CM * PX_PER_CM
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(margin * 2 + cardW)
    canvas.height = Math.round(margin * 2 + cardH)
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const qrImg = await loadImage(dataUrl)
    drawCardCanvas(ctx, margin, margin, cardW, cardH, PX_PER_CM, qrImg, displayLabel, displayValue)

    const a = document.createElement("a")
    a.href = canvas.toDataURL("image/png")
    a.download = `${displayValue}-qr-card.png`
    a.click()
  }

  // --- PDF: exact-size page (mm) so it prints true-to-size ---
  function handleDownloadPdf() {
    const dataUrl = currentQrDataUrl()
    if (!dataUrl) return
    const margin = 3
    const cardW = CARD_W_CM * 10 // mm
    const cardH = CARD_H_CM * 10
    const pageW = margin * 2 + cardW
    const pageH = margin * 2 + cardH
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [pageW, pageH] })

    drawCardPdf(doc, margin, margin, dataUrl, displayLabel, displayValue)

    doc.save(`${displayValue}-qr-card.pdf`)
  }

  // --- Browser print at true physical size via cm dimensions + @page ---
  function handlePrint() {
    const dataUrl = currentQrDataUrl()
    if (!dataUrl) return
    const printWindow = window.open("", "_blank", "width=800,height=400")
    if (!printWindow) return
    const cardHtml = `
      <div class="card">
        <img src="${dataUrl}" alt="QR" />
        <div class="meta">
          <div class="label">${displayLabel}</div>
          <div class="value">${displayValue}</div>
        </div>
      </div>`
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${displayValue} — QR Card</title>
          <style>
            @page { size: auto; margin: 8mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
            .card {
              width: ${CARD_W_CM}cm; height: ${CARD_H_CM}cm;
              display: flex; align-items: center; gap: 0.2cm;
              padding: ${PAD_CM}cm; overflow: hidden; background: #ffffff;
            }
            .card img { width: ${QR_CM}cm; height: ${QR_CM}cm; display: block; }
            .meta { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
            .label { font-size: 8pt; color: ${LABEL_COLOR}; text-transform: uppercase; letter-spacing: 0.5px; }
            /* No white-space: nowrap — a short order number still reads as
               one line at this width/size, but a longer member account
               number wraps onto a second line (breaking after a "-" where
               possible) instead of running off the card. */
            .value { font-size: 8pt; font-weight: 700; font-family: 'Courier New', monospace; color: ${VALUE_COLOR}; }
          </style>
        </head>
        <body>
          ${cardHtml}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => printWindow.print(), 300)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Printable QR Card</DialogTitle>
          <DialogDescription>
            One 4.5 × 3 cm card for {isOrderCard ? `order #${displayValue}` : `member account #${displayValue}`}.
            Scanning opens a read-only profile — no login required.
          </DialogDescription>
        </DialogHeader>

        {/* On-screen preview at true cm size (single card). The QR renders
            directly here at a high backing resolution (512px) scaled down via
            CSS, so it's always visible and doubles as the export source (read
            through qrCanvasRef at click time). */}
        <div className="flex justify-center overflow-x-auto py-2">
          <PreviewCard qrCanvasRef={qrCanvasRef} scanUrl={scanUrl} label={displayLabel} value={displayValue} />
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyLink}>
            <Copy className="h-3.5 w-3.5" /> Copy
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPng}>
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPdf}>
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PreviewCard({
  qrCanvasRef,
  scanUrl,
  label,
  value,
}: {
  qrCanvasRef: React.Ref<HTMLCanvasElement>
  scanUrl: string
  label: string
  value: string
}) {
  const valueRef = React.useRef<HTMLDivElement>(null)
  const [valueFontPt, setValueFontPt] = React.useState(12)
  // A ~10-char order number always ends up fitting on one line well above
  // the shrink floor. A member account number (e.g. "0001-000-0000-0011")
  // can be long enough that it still overflows even at the smallest
  // readable size — rather than clipping it, this switches that value to
  // wrap onto a second line (word-break naturally prefers the "-"s in it).
  const [valueWraps, setValueWraps] = React.useState(false)

  // Shrink the value until it fits its column on a single line — mirrors the
  // auto-fit the PNG/PDF exports do on canvas.
  React.useEffect(() => {
    const el = valueRef.current
    if (!el) return
    let size = 12
    el.style.whiteSpace = "nowrap"
    el.style.fontSize = `${size}pt`
    while (el.scrollWidth > el.clientWidth && size > 5) {
      size -= 0.5
      el.style.fontSize = `${size}pt`
    }
    setValueWraps(el.scrollWidth > el.clientWidth)
    setValueFontPt(size)
  }, [value, scanUrl])

  return (
    <div
      style={{
        width: `${CARD_W_CM}cm`,
        height: `${CARD_H_CM}cm`,
        padding: `${PAD_CM}cm`,
        gap: "0.2cm",
        background: CARD_BG,
      }}
      className="flex items-center rounded-sm overflow-hidden shrink-0"
    >
      <CustomerQrCanvas
        ref={qrCanvasRef}
        value={scanUrl}
        size={512}
        style={{ width: `${QR_CM}cm`, height: `${QR_CM}cm` }}
      />
      <div className="flex flex-1 flex-col justify-center min-w-0">
        <div style={{ fontSize: "8pt", letterSpacing: "0.5px", color: LABEL_COLOR }} className="uppercase">
          {label}
        </div>
        <div
          ref={valueRef}
          style={{ fontSize: `${valueFontPt}pt`, color: VALUE_COLOR, whiteSpace: valueWraps ? "normal" : "nowrap" }}
          className="font-mono font-bold leading-tight overflow-hidden"
        >
          {value}
        </div>
      </div>
    </div>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// A member account number is long enough that even the smallest readable
// font can still overflow the ~1.7cm text column that comfortably fits a
// ~10-char order number. Rather than let it run off the card, split it onto
// two lines — canvas/PDF text never wraps on its own the way HTML does —
// preferring to break right after a "-" near the middle if there is one.
function splitNearMiddle(text: string): [string, string] {
  const mid = Math.floor(text.length / 2)
  for (let offset = 0; offset < 4; offset++) {
    if (text[mid + offset] === "-") return [text.slice(0, mid + offset + 1), text.slice(mid + offset + 1)]
    if (text[mid - offset] === "-") return [text.slice(0, mid - offset + 1), text.slice(mid - offset + 1)]
  }
  return [text.slice(0, mid), text.slice(mid)]
}

function drawCardCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  pxPerCm: number,
  qrImg: HTMLImageElement,
  label: string,
  value: string
) {
  const pad = PAD_CM * pxPerCm
  const qr = QR_CM * pxPerCm

  // Plain white card — the canvas is already filled white by the caller, so
  // there's no background rect or border to draw here.

  // QR on the left, vertically centered.
  ctx.drawImage(qrImg, x + pad, y + (cardH - qr) / 2, qr, qr)

  // Meta on the right
  const textX = x + pad + qr + 0.2 * pxPerCm
  const maxTextW = x + cardW - pad - textX

  // Auto-fit the label too — canvas text never wraps, and "Member Account #"
  // is much longer than "Order #".
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = LABEL_COLOR
  let labelFs = 0.28 * pxPerCm
  ctx.font = `${labelFs}px Arial`
  while (ctx.measureText(label).width > maxTextW && labelFs > 0.12 * pxPerCm) {
    labelFs -= 1
    ctx.font = `${labelFs}px Arial`
  }
  ctx.fillText(label, textX, y + cardH / 2 - 0.15 * pxPerCm)

  // Auto-fit the value to the available width; if it still doesn't fit even
  // at the smallest readable size, split it onto two lines instead.
  ctx.fillStyle = VALUE_COLOR
  let fs = 0.46 * pxPerCm
  ctx.font = `bold ${fs}px 'Courier New', monospace`
  while (ctx.measureText(value).width > maxTextW && fs > 0.2 * pxPerCm) {
    fs -= 1
    ctx.font = `bold ${fs}px 'Courier New', monospace`
  }
  if (ctx.measureText(value).width > maxTextW) {
    const [line1, line2] = splitNearMiddle(value)
    ctx.fillText(line1, textX, y + cardH / 2 + 0.22 * pxPerCm)
    ctx.fillText(line2, textX, y + cardH / 2 + 0.6 * pxPerCm)
  } else {
    ctx.fillText(value, textX, y + cardH / 2 + 0.42 * pxPerCm)
  }
}

function drawCardPdf(doc: jsPDF, x: number, y: number, qrDataUrl: string, label: string, value: string) {
  const cardW = CARD_W_CM * 10
  const cardH = CARD_H_CM * 10
  const pad = PAD_CM * 10
  const qr = QR_CM * 10

  // Plain white card — jsPDF pages are white by default, so no background rect
  // or border is drawn.

  doc.addImage(qrDataUrl, "PNG", x + pad, y + (cardH - qr) / 2, qr, qr)

  const textX = x + pad + qr + 2
  const maxTextW = x + cardW - pad - textX

  // Auto-fit the label too — "Member Account #" is much longer than "Order #".
  doc.setTextColor(107, 114, 128) // #6b7280 gray
  doc.setFont("helvetica", "normal")
  let labelFs = 7
  doc.setFontSize(labelFs)
  while (doc.getTextWidth(label) > maxTextW && labelFs > 4) {
    labelFs -= 0.5
    doc.setFontSize(labelFs)
  }
  doc.text(label, textX, cardH / 2 + y - 1.5)

  // Auto-fit the value; if it still doesn't fit even at the smallest
  // readable size, split it onto two lines instead.
  doc.setTextColor(15, 23, 41) // #0f1729 navy
  doc.setFont("courier", "bold")
  let fs = 12
  doc.setFontSize(fs)
  while (doc.getTextWidth(value) > maxTextW && fs > 5) {
    fs -= 0.5
    doc.setFontSize(fs)
  }
  if (doc.getTextWidth(value) > maxTextW) {
    const [line1, line2] = splitNearMiddle(value)
    doc.text(line1, textX, cardH / 2 + y + 1.5)
    doc.text(line2, textX, cardH / 2 + y + 4.5)
  } else {
    doc.text(value, textX, cardH / 2 + y + 3)
  }
}
