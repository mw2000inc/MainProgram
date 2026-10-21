import jsPDF from "jspdf"

// The printable QR card (4.5cm x 3cm): QR on the left, label + value (+ the
// product name on an order card) on the right — drawn for the PNG / PDF
// exports. Shared by the member's printable-card dialog and the order QR's
// Download (Sale List / Member order detail), so both save the same card.

// Physical card spec from the printable-card design: a single 4.5cm x 3cm
// landscape card. Everything below is derived from these so the on-screen
// preview, PNG, PDF and browser print all come out the same true size.
export const CARD_W_CM = 4.5
export const CARD_H_CM = 3
export const QR_CM = 2.2
export const PAD_CM = 0.2

// Card color scheme: plain white card, no background fill and no border. The QR
// is black-on-white (qrcode.react renders its own white quiet-zone). The small
// label is a muted gray so the bold navy value is the clear focal point next
// to it, matching the reference card layout.
export const CARD_BG = "#ffffff"
export const LABEL_COLOR = "#6b7280"
export const VALUE_COLOR = "#0f1729"


export function loadImage(src: string): Promise<HTMLImageElement> {
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
export function splitNearMiddle(text: string): [string, string] {
  const mid = Math.floor(text.length / 2)
  for (let offset = 0; offset < 4; offset++) {
    if (text[mid + offset] === "-") return [text.slice(0, mid + offset + 1), text.slice(mid + offset + 1)]
    if (text[mid - offset] === "-") return [text.slice(0, mid - offset + 1), text.slice(mid - offset + 1)]
  }
  return [text.slice(0, mid), text.slice(mid)]
}

// Product# is stored as "{code} / {name}" (e.g. "102 / MW) F5"), and name
// itself often has its own brand-code prefix baked in ("MW) F5", "SK)
// Standard K (black)") — verified against every one of the 14 distinct
// product_no values actually on file before writing this, including
// legacy rows that are just a bare name with no code/slash at all ("F5",
// "Hercules"). Takes everything after the first " / " (or the whole
// string if there's no slash), strips any such leading "XX) " prefix to
// get the plain base name, then re-adds a plain "MW " prefix (no
// parenthesis) only for the F5 and F7 products specifically — every other
// product (Hercules, Oasis-S2, Standard K, the PR/ETC groups, etc.) shows
// its plain name with no prefix at all, regardless of which brand group
// it actually belongs to.
export function extractProductName(productNo: string): string {
  const afterSlash = productNo.includes(" / ") ? productNo.split(" / ").slice(1).join(" / ").trim() : productNo.trim()
  const baseName = afterSlash.replace(/^[A-Za-z]{2,4}\)\s*/, "")
  return baseName === "F5" || baseName === "F7" ? `MW ${baseName}` : baseName
}

// Shrinks font size (via setSize) down to minSize while `text` overflows
// maxWidth; if it's still too wide even at the floor, truncates the string
// itself with an ellipsis rather than letting it run off the card —
// appropriate for the product name line specifically, a supporting detail
// rather than the primary lookup key (which wraps onto two lines instead,
// see splitNearMiddle/drawCardCanvas's own value handling). Shared between
// the canvas and PDF export paths rather than writing the same shrink-then-
// truncate loop twice.
export function fitTextOrTruncate(
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  setSize: (size: number) => void,
  measure: (text: string) => number
): string {
  let size = startSize
  setSize(size)
  while (measure(text) > maxWidth && size > minSize) {
    size -= 1
    setSize(size)
  }
  if (measure(text) <= maxWidth) return text
  let truncated = text
  while (truncated.length > 1 && measure(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return `${truncated}…`
}

export function drawCardCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  pxPerCm: number,
  qrImg: HTMLImageElement,
  label: string,
  value: string,
  productName?: string
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

  // Third, secondary line — order cards only (productName is never passed
  // for a member-level card, whose value also never wraps to two lines, so
  // there's no conflict between this and the split-onto-two-lines branch
  // above). Plain weight, shrunk then truncated with an ellipsis rather
  // than wrapped — see fitTextOrTruncate's own comment.
  if (productName) {
    ctx.fillStyle = VALUE_COLOR
    let productFs = 0.345 * pxPerCm
    ctx.font = `${productFs}px Arial`
    const fitted = fitTextOrTruncate(
      productName,
      maxTextW,
      productFs,
      0.18 * pxPerCm,
      (size) => {
        productFs = size
        ctx.font = `${size}px Arial`
      },
      (text) => ctx.measureText(text).width
    )
    ctx.fillText(fitted, textX, y + cardH / 2 + 0.82 * pxPerCm)
  }
}

export function drawCardPdf(doc: jsPDF, x: number, y: number, qrDataUrl: string, label: string, value: string, productName?: string) {
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

  // Third, secondary line — order cards only, same reasoning as
  // drawCardCanvas's own copy of this.
  if (productName) {
    doc.setTextColor(15, 23, 41) // same navy as the value, but plain weight
    doc.setFont("helvetica", "normal")
    let productFs = 7
    doc.setFontSize(productFs)
    const fitted = fitTextOrTruncate(
      productName,
      maxTextW,
      productFs,
      4.5,
      (size) => {
        productFs = size
        doc.setFontSize(size)
      },
      (text) => doc.getTextWidth(text)
    )
    doc.text(fitted, textX, cardH / 2 + y + 6)
  }
}

// Saves the card as a PNG at ~300 DPI (the same composition the printable
// card dialog's PNG button makes).
export async function downloadQrCardPng(opts: { qrDataUrl: string; label: string; value: string; productName?: string; fileName: string }) {
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
  const qrImg = await loadImage(opts.qrDataUrl)
  drawCardCanvas(ctx, margin, margin, cardW, cardH, PX_PER_CM, qrImg, opts.label, opts.value, opts.productName)
  const a = document.createElement("a")
  a.href = canvas.toDataURL("image/png")
  a.download = opts.fileName
  a.click()
}
