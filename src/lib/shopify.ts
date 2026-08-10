import "server-only"
import crypto from "node:crypto"
import type { PaymentMethod, PaymentStatus } from "@/lib/types"

// Read access to orders (for the webhook payload) and products (in case we ever
// need to cross-check against Shopify's own catalog) — kept minimal on purpose,
// this app never writes anything back to Shopify.
export const SHOPIFY_SCOPES = "read_orders,read_products"

// Shopify's REST Admin API is versioned quarterly (YYYY-01/04/07/10) and old
// versions eventually stop working — overridable via env without a code change
// if this default ever gets sunset.
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01"

export function shopifyAuthorizeUrl({
  shop,
  clientId,
  redirectUri,
  state,
}: {
  shop: string
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`)
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("scope", SHOPIFY_SCOPES)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  return url.toString()
}

export async function exchangeCodeForAccessToken({
  shop,
  clientId,
  clientSecret,
  code,
}: {
  shop: string
  clientId: string
  clientSecret: string
  code: string
}): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  })
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string; scope: string }
  return { accessToken: data.access_token, scope: data.scope }
}

// Shopify signs the OAuth callback's own query string (every param except hmac
// itself) with the app's client secret. Verifying this stops someone from
// hitting the callback URL directly with a forged code/shop pair to try to
// trigger a token exchange for a store they don't control.
export function verifyOAuthCallbackHmac(searchParams: URLSearchParams, clientSecret: string): boolean {
  const hmac = searchParams.get("hmac")
  if (!hmac) return false

  const params = new URLSearchParams(searchParams)
  params.delete("hmac")
  params.delete("signature")
  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

  const digest = crypto.createHmac("sha256", clientSecret).update(message).digest("hex")
  return timingSafeEqualEncoded(digest, hmac, "hex")
}

// Verifies a webhook delivery's X-Shopify-Hmac-Sha256 header against the RAW
// request body using the app's client secret. Must run on the raw bytes/text
// before any JSON.parse — Shopify signs exactly what it sent over the wire,
// and re-serializing parsed JSON can produce a different byte sequence
// (key order, whitespace) that would no longer match a legitimate request.
export function verifyWebhookHmac(rawBody: string, hmacHeader: string | null, clientSecret: string): boolean {
  if (!hmacHeader) return false
  const digest = crypto.createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64")
  return timingSafeEqualEncoded(digest, hmacHeader, "base64")
}

function timingSafeEqualEncoded(a: string, b: string, encoding: "hex" | "base64"): boolean {
  let bufA: Buffer
  let bufB: Buffer
  try {
    bufA = Buffer.from(a, encoding)
    bufB = Buffer.from(b, encoding)
  } catch {
    return false
  }
  // timingSafeEqual throws on mismatched lengths rather than just returning
  // false, so guard that first — a length mismatch alone is safe to reveal
  // (it doesn't leak anything about the actual digest bytes).
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export async function registerWebhook({
  shop,
  accessToken,
  topic,
  callbackUrl,
}: {
  shop: string
  accessToken: string
  topic: string
  callbackUrl: string
}): Promise<void> {
  const res = await fetch(`https://${shop}/admin/api/${API_VERSION}/webhooks.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ webhook: { topic, address: callbackUrl, format: "json" } }),
  })
  if (!res.ok) {
    // A 422 here usually means a webhook for this topic+address already
    // exists (e.g. re-running the install flow) — not fatal, so don't throw,
    // just surface it for the callback route to log.
    const body = await res.text()
    if (res.status !== 422) {
      throw new Error(`Failed to register Shopify ${topic} webhook (${res.status}): ${body}`)
    }
  }
}

// Maps Shopify's financial_status to MW2000's fixed PaymentStatus enum, which
// has no direct equivalent for every Shopify state (e.g. refunded/voided) —
// those fall back to Pending as a known simplification.
export function mapShopifyPaymentStatus(financialStatus: string): PaymentStatus {
  if (financialStatus === "paid") return "Paid"
  if (financialStatus === "partially_paid") return "Partial"
  return "Pending"
}

// Shopify orders don't carry a payment method that maps cleanly onto this
// app's fixed enum (Cash/Bank Transfer/Credit Card/GCash/Check) — Shopify
// Payments/checkout card payments are by far the common case, so that's the
// default for every order regardless of the actual gateway used (including
// Cash on Delivery, which Shopify itself tracks via financial_status/gateway
// rather than a distinct "payment method" MW2000 has an enum value for).
export const SHOPIFY_PAYMENT_METHOD: PaymentMethod = "Credit Card"

// The shipping fee the customer paid. Shopify exposes it as
// total_shipping_price_set.shop_money.amount on the order; older/edge payloads
// only carry per-line shipping_lines, so sum those as a fallback.
export function shopifyShippingAmount(order: ShopifyOrder): number {
  const fromSet = Number(order.total_shipping_price_set?.shop_money?.amount)
  if (Number.isFinite(fromSet) && fromSet > 0) return fromSet
  const fromLines = (order.shipping_lines ?? []).reduce((sum, l) => sum + (Number(l.price) || 0), 0)
  return fromLines
}

export interface ShopifyLineItem {
  sku: string | null
  quantity: number
  price: string
  // The discount amount allocated to this specific line (already accounts
  // for both line-level and order-level discount codes Shopify allocates
  // proportionally) — subtract this to get what the customer actually paid
  // for the line, since `price` alone is the pre-discount unit price.
  total_discount: string
  title: string
}

export interface ShopifyCustomer {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
}

export interface ShopifyAddress {
  first_name: string | null
  last_name: string | null
  phone: string | null
  address1: string | null
  address2: string | null
  city: string | null
  province: string | null
  country: string | null
  zip: string | null
}

export interface ShopifyOrder {
  id: number
  order_number: number
  name: string
  created_at: string
  cancelled_at: string | null
  test: boolean
  financial_status: string
  total_price: string
  total_discounts: string
  // Order-level shipping total; shipping_lines is the per-line breakdown used as
  // a fallback. Either may be absent on orders with no shipping.
  total_shipping_price_set?: { shop_money?: { amount?: string } } | null
  shipping_lines?: { price: string; title?: string }[]
  line_items: ShopifyLineItem[]
  // Null for guest checkouts with no Shopify customer account — fall back to
  // the order-level email/phone and the billing address in that case.
  customer: ShopifyCustomer | null
  email: string | null
  phone: string | null
  billing_address: ShopifyAddress | null
}
