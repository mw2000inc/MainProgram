import type { ReleaseSlipMovement } from "@/lib/api/release-slip"

// One line per item on a job: the same item saved in several pieces (a
// quantity raised on the slip is saved as an extra entry — 605 ×1 then ×3) is
// shown as one line with its total (605 ×4), as typed. Kept apart: OUT vs IN,
// a different For / type box, pending vs approved.
export function mergeSlipLines(lines: ReleaseSlipMovement[]): ReleaseSlipMovement[] {
  const out: ReleaseSlipMovement[] = []
  const byKey = new Map<string, ReleaseSlipMovement>()
  for (const m of lines) {
    const code = (m.sku || m.label).trim()
    const kind = m.qtyOut && m.qtyIn ? "both" : m.qtyOut ? "out" : "in"
    const key = [code, kind, m.status, m.purpose ?? "", m.slipType ?? ""].join("|")
    const seen = code && kind !== "both" ? byKey.get(key) : undefined
    if (seen) {
      seen.qtyOut += m.qtyOut
      seen.qtyIn += m.qtyIn
      continue
    }
    const line = { ...m }
    if (code) byKey.set(key, line)
    out.push(line)
  }
  return out
}

// A slip line's item and side ("605|out"), for keeping lines in place.
export function lineCode(m: { sku: string; label: string; qtyOut: number; qtyIn: number }): string {
  return `${(m.sku || m.label).trim()}|${m.qtyOut ? "out" : m.qtyIn ? "in" : ""}`
}

// The lines in the order last shown (order: their codes); lines not shown
// before keep the database's order, after them.
export function inShownOrder<T extends { sku: string; label: string; qtyOut: number; qtyIn: number }>(lines: T[], order: string[] | undefined): T[] {
  if (!order?.length) return lines
  const rank = (m: T) => {
    const i = order.indexOf(lineCode(m))
    return i < 0 ? order.length : i
  }
  return lines.map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).map((x) => x.m)
}
