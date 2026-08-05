"use client"

import * as React from "react"
import { QRCodeCanvas } from "qrcode.react"
import { Copy, Download, Printer, FileText } from "lucide-react"
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

// Card color scheme (matches the QR modal): dark navy card, light-gray label,
// white value. No border. The QR image itself carries its own white quiet-zone
// square (qrcode.react renders a white background), so it stays scannable
// sitting directly on the navy.
const CARD_BG = "#0f1729"
const LABEL_COLOR = "#9ca3af"
const VALUE_COLOR = "#ffffff"

export function CustomerQrDialog({
  open,
  onOpenChange,
  customer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer
}) {
  const qrCanvasRef = React.useRef<HTMLCanvasElement>(null)
  const [scanUrl, setScanUrl] = React.useState("")
  const [qrDataUrl, setQrDataUrl] = React.useState("")

  React.useEffect(() => {
    // window.location.origin is a client-only external value, unavailable during SSR.
    if (open && typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScanUrl(`${window.location.origin}/scan/${customer.id}`)
    }
  }, [open, customer.id])

  // qrcode.react paints the hidden high-res canvas synchronously on render, so by
  // the time this effect runs (after paint) we can snapshot it to a PNG data URL
  // and reuse that single image for the preview, PNG, PDF and print output.
  React.useEffect(() => {
    if (scanUrl && qrCanvasRef.current) {
      setQrDataUrl(qrCanvasRef.current.toDataURL("image/png"))
    }
  }, [scanUrl])

  function currentQrDataUrl(): string {
    return qrDataUrl || qrCanvasRef.current?.toDataURL("image/png") || ""
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
    drawCardCanvas(ctx, margin, margin, cardW, cardH, PX_PER_CM, qrImg, customer.orderNumber)

    const a = document.createElement("a")
    a.href = canvas.toDataURL("image/png")
    a.download = `${customer.orderNumber}-qr-card.png`
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

    drawCardPdf(doc, margin, margin, dataUrl, customer.orderNumber)

    doc.save(`${customer.orderNumber}-qr-card.pdf`)
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
          <div class="label">Order #</div>
          <div class="value">${customer.orderNumber}</div>
        </div>
      </div>`
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${customer.orderNumber} — QR Card</title>
          <style>
            @page { size: auto; margin: 8mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
            .card {
              width: ${CARD_W_CM}cm; height: ${CARD_H_CM}cm;
              border-radius: 2mm;
              display: flex; align-items: center; gap: 0.2cm;
              padding: ${PAD_CM}cm; overflow: hidden; background: ${CARD_BG};
              -webkit-print-color-adjust: exact; print-color-adjust: exact;
            }
            .card img { width: ${QR_CM}cm; height: ${QR_CM}cm; display: block; }
            .meta { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
            .label { font-size: 8pt; color: ${LABEL_COLOR}; text-transform: uppercase; letter-spacing: 0.5px; }
            /* 8pt keeps a 10-char order number (e.g. SK001-0015) on one line in
               the ~1.7cm text column — matches the auto-fit the PNG/PDF do. */
            .value { font-size: 8pt; font-weight: 700; font-family: 'Courier New', monospace; white-space: nowrap; color: ${VALUE_COLOR}; }
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
            One 4.5 × 3 cm card for order #{customer.orderNumber}. Scanning opens a read-only profile — no login
            required.
          </DialogDescription>
        </DialogHeader>

        {/* Hidden high-res QR used as the source image for preview/export/print. */}
        <div style={{ position: "absolute", left: "-9999px", top: 0 }} aria-hidden>
          {scanUrl && <QRCodeCanvas ref={qrCanvasRef} value={scanUrl} size={512} level="M" marginSize={2} />}
        </div>

        {/* On-screen preview at true cm size (single card). */}
        <div className="flex justify-center overflow-x-auto py-2">
          <PreviewCard qrDataUrl={qrDataUrl} orderNumber={customer.orderNumber} />
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

function PreviewCard({ qrDataUrl, orderNumber }: { qrDataUrl: string; orderNumber: string }) {
  const valueRef = React.useRef<HTMLDivElement>(null)
  const [valueFontPt, setValueFontPt] = React.useState(12)

  // Shrink the order number until it fits its column on a single line —
  // mirrors the auto-fit the PNG/PDF exports do on canvas, so a 10-char order
  // number like SK001-0015 stays on one line in the narrow (~1.7cm) text area.
  React.useEffect(() => {
    const el = valueRef.current
    if (!el) return
    let size = 12
    el.style.fontSize = `${size}pt`
    while (el.scrollWidth > el.clientWidth && size > 5) {
      size -= 0.5
      el.style.fontSize = `${size}pt`
    }
    setValueFontPt(size)
  }, [orderNumber, qrDataUrl])

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
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrDataUrl} alt="QR code" style={{ width: `${QR_CM}cm`, height: `${QR_CM}cm` }} />
      ) : (
        <div style={{ width: `${QR_CM}cm`, height: `${QR_CM}cm` }} className="bg-neutral-100 animate-pulse" />
      )}
      <div className="flex flex-1 flex-col justify-center min-w-0">
        <div style={{ fontSize: "8pt", letterSpacing: "0.5px", color: LABEL_COLOR }} className="uppercase">
          Order #
        </div>
        <div
          ref={valueRef}
          style={{ fontSize: `${valueFontPt}pt`, color: VALUE_COLOR }}
          className="font-mono font-bold leading-tight whitespace-nowrap overflow-hidden"
        >
          {orderNumber}
        </div>
      </div>
    </div>
  )
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawCardCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  pxPerCm: number,
  qrImg: HTMLImageElement,
  orderNumber: string
) {
  const pad = PAD_CM * pxPerCm
  const qr = QR_CM * pxPerCm
  const radius = 0.08 * pxPerCm

  // Navy card background, no border.
  ctx.fillStyle = CARD_BG
  roundedRectPath(ctx, x, y, cardW, cardH, radius)
  ctx.fill()

  // QR on the left, vertically centered (its own white quiet zone keeps it
  // scannable against the navy).
  ctx.drawImage(qrImg, x + pad, y + (cardH - qr) / 2, qr, qr)

  // Meta on the right
  const textX = x + pad + qr + 0.2 * pxPerCm
  const maxTextW = x + cardW - pad - textX

  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = LABEL_COLOR
  ctx.font = `${0.28 * pxPerCm}px Arial`
  ctx.fillText("ORDER #", textX, y + cardH / 2 - 0.15 * pxPerCm)

  // Auto-fit the order number to the available width.
  ctx.fillStyle = VALUE_COLOR
  let fs = 0.46 * pxPerCm
  ctx.font = `bold ${fs}px 'Courier New', monospace`
  while (ctx.measureText(orderNumber).width > maxTextW && fs > 0.2 * pxPerCm) {
    fs -= 1
    ctx.font = `bold ${fs}px 'Courier New', monospace`
  }
  ctx.fillText(orderNumber, textX, y + cardH / 2 + 0.42 * pxPerCm)
}

function drawCardPdf(doc: jsPDF, x: number, y: number, qrDataUrl: string, orderNumber: string) {
  const cardW = CARD_W_CM * 10
  const cardH = CARD_H_CM * 10
  const pad = PAD_CM * 10
  const qr = QR_CM * 10

  // Navy card background, no border.
  doc.setFillColor(15, 23, 41) // #0f1729
  doc.roundedRect(x, y, cardW, cardH, 0.8, 0.8, "F")

  doc.addImage(qrDataUrl, "PNG", x + pad, y + (cardH - qr) / 2, qr, qr)

  const textX = x + pad + qr + 2
  const maxTextW = x + cardW - pad - textX

  doc.setTextColor(156, 163, 175) // #9ca3af
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7)
  doc.text("ORDER #", textX, cardH / 2 + y - 1.5)

  doc.setTextColor(255, 255, 255)
  doc.setFont("courier", "bold")
  let fs = 12
  doc.setFontSize(fs)
  while (doc.getTextWidth(orderNumber) > maxTextW && fs > 5) {
    fs -= 0.5
    doc.setFontSize(fs)
  }
  doc.text(orderNumber, textX, cardH / 2 + y + 3)
}
