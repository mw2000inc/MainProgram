// Online-store slips on the Release Slip page (admin only): the items sent
// out (or returned) for Shopee / Lazada orders. Each order's items are
// Inventory movements with the channel as reason and "<order no.> — <buyer>"
// as reference (see /api/release-slip/channel).
export const SLIP_CHANNELS = ["Shopee", "Lazada"] as const
export type SlipChannel = (typeof SLIP_CHANNELS)[number]

const SEPARATOR = " — "

export function channelReference(orderNo: string, accountName: string): string {
  const order = orderNo.trim()
  const name = accountName.replace(/\s+/g, " ").trim()
  return name ? `${order}${SEPARATOR}${name}` : order
}

export function parseChannelReference(reference: string | null | undefined): { orderNo: string; accountName: string } {
  const text = (reference ?? "").trim()
  const at = text.indexOf(SEPARATOR)
  return at < 0 ? { orderNo: text, accountName: "" } : { orderNo: text.slice(0, at).trim(), accountName: text.slice(at + SEPARATOR.length).trim() }
}
