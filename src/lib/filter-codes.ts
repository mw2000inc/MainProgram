// A job's filters live in schedule_jobs.filter_codes as the same
// comma-separated codes Filter Change uses, with a filter's QUANTITY written
// as repetition: "011, 011, 013" = two 011s and one 013. That's the form every
// deduction path already reads — a Filter Change record's completion
// (20261019000000), batch completion (complete-jobs.ts) and an unlinked job's
// completion (20261105000000) all count repeats and match each code to a
// product SKU; a code with no product (typed by hand) is kept but not
// deducted.

export type FilterLine = { code: string; quantity: number }

// The code of an inventory pick ("013 / MW) Sediment" → "013"), or the typed
// text itself.
export function filterCodeOf(value: string): string {
  return value.split(" / ")[0].trim()
}

// "011, 011, 013" → [{ code: "011", quantity: 2 }, { code: "013", quantity: 1 }],
// in first-seen order.
export function parseFilterCodes(codes: string | null | undefined): FilterLine[] {
  const lines: FilterLine[] = []
  for (const raw of (codes ?? "").split(",")) {
    const code = raw.trim()
    if (!code) continue
    const line = lines.find((l) => l.code === code)
    if (line) line.quantity += 1
    else lines.push({ code, quantity: 1 })
  }
  return lines
}

// The reverse: each code repeated quantity times.
export function encodeFilterCodes(lines: FilterLine[]): string {
  return lines
    .filter((l) => l.code.trim() && l.quantity > 0)
    .flatMap((l) => Array.from({ length: Math.floor(l.quantity) }, () => l.code.trim()))
    .join(", ")
}

// For reading: "011 ×2, 013".
export function formatFilterCodes(codes: string | null | undefined): string {
  return parseFilterCodes(codes)
    .map((l) => (l.quantity > 1 ? `${l.code} ×${l.quantity}` : l.code))
    .join(", ")
}
