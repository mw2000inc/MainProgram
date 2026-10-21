"use client"

import * as React from "react"
import { Copy, Download, Printer, FileText } from "lucide-react"
import { CustomerQrCanvas, getScanUrl } from "@/components/customers/customer-qr-code"
import jsPDF from "jspdf"
import {
  CARD_BG,
  CARD_H_CM,
  CARD_W_CM,
  LABEL_COLOR,
  PAD_CM,
  QR_CM,
  VALUE_COLOR,
  drawCardPdf,
  extractProductName,
  downloadQrCardPng,
} from "@/components/customers/qr-card"
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
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Customer } from "@/lib/types"

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
  // That same order's own Product# (e.g. "102 / MW) F5") — only meaningful
  // alongside orderNumber; a member-level card has no single associated
  // product, since one member can have several orders. See
  // extractProductName's own comment for the extraction rule.
  productNo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer
  orderNumber?: string
  productNo?: string
}) {
  const { t } = useTranslation("member")
  const { t: tCommon } = useTranslation("common")
  const isOrderCard = orderNumber !== undefined
  // These two labels get baked directly into the printed/exported card (PNG,
  // PDF, browser print) — kept in English regardless of interface language,
  // same as the other modules' print/export column headers, so a physical
  // card is never split mid-batch between two languages.
  const displayLabel = isOrderCard ? "Order #" : "Member Account #"
  const displayValue = isOrderCard ? orderNumber : customer.memberAccountNumber
  const productName = isOrderCard && productNo ? extractProductName(productNo) : undefined
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
    toast.success(t("scanLinkCopied"))
  }

  // --- PNG: compose the single card onto one canvas at ~300 DPI ---
  async function handleDownloadPng() {
    const dataUrl = currentQrDataUrl()
    if (!dataUrl) return
    await downloadQrCardPng({ qrDataUrl: dataUrl, label: displayLabel, value: displayValue, productName, fileName: `${displayValue}-qr-card.png` })
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

    drawCardPdf(doc, margin, margin, dataUrl, displayLabel, displayValue, productName)

    doc.save(`${displayValue}-qr-card.pdf`)
  }

  // --- Browser print at true physical size via cm dimensions + @page ---
  function handlePrint() {
    const dataUrl = currentQrDataUrl()
    if (!dataUrl) return
    const printWindow = window.open("", "_blank", "width=800,height=400")
    if (!printWindow) return
    // Not HTML-escaped, matching displayLabel/displayValue right below —
    // this print window is a transient preview only, never persisted.
    const productHtml = productName ? `<div class="product">${productName}</div>` : ""
    const cardHtml = `
      <div class="card">
        <img src="${dataUrl}" alt="QR" />
        <div class="meta">
          <div class="label">${displayLabel}</div>
          <div class="value">${displayValue}</div>
          ${productHtml}
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
            /* Secondary line — the product name, order cards only. Plain
               weight and truncated with an ellipsis rather than wrapped:
               this is a supporting detail, not the primary lookup key, and
               there's no spare vertical space on a 3cm-tall card to give a
               long product name a second line. */
            .product {
              font-size: 8pt; color: ${VALUE_COLOR}; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; margin-top: 1px;
            }
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
          <DialogTitle>{t("printableQrCard")}</DialogTitle>
          <DialogDescription>
            {t(isOrderCard ? "qrDescriptionOrder" : "qrDescriptionMember", { value: displayValue ?? "" })}
          </DialogDescription>
        </DialogHeader>

        {/* On-screen preview at true cm size (single card). The QR renders
            directly here at a high backing resolution (512px) scaled down via
            CSS, so it's always visible and doubles as the export source (read
            through qrCanvasRef at click time). */}
        <div className="flex justify-center overflow-x-auto py-2">
          <PreviewCard qrCanvasRef={qrCanvasRef} scanUrl={scanUrl} label={displayLabel} value={displayValue} productName={productName} />
        </div>

        <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopyLink}>
            <Copy className="h-3.5 w-3.5" /> {tCommon("copy")}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPng}>
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownloadPdf}>
            <FileText className="h-3.5 w-3.5" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" /> {tCommon("print")}
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
  productName,
}: {
  qrCanvasRef: React.Ref<HTMLCanvasElement>
  scanUrl: string
  label: string
  value: string
  productName?: string
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
        {/* Secondary line — order cards only, plain weight and truncated
            with an ellipsis (via CSS, same idea as the print HTML's own
            .product rule) rather than wrapped: a supporting detail, not
            the primary lookup key, and there's no spare vertical space on
            a 3cm-tall card for a second line here. */}
        {productName && (
          <div
            style={{ fontSize: "8pt", color: VALUE_COLOR, marginTop: "1px" }}
            className="truncate"
          >
            {productName}
          </div>
        )}
      </div>
    </div>
  )
}

