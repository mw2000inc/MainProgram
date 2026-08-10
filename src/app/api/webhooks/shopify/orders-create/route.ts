import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  mapShopifyPaymentStatus,
  shopifyShippingAmount,
  verifyWebhookHmac,
  SHOPIFY_PAYMENT_METHOD,
  type ShopifyOrder,
} from "@/lib/shopify"

type AdminClient = ReturnType<typeof createAdminClient>

function formatBillingAddress(order: ShopifyOrder): string {
  const a = order.billing_address
  if (!a) return "N/A"
  const line = [a.address1, a.address2].filter(Boolean).join(" ")
  const cityLine = [a.city, a.province, a.zip].filter(Boolean).join(", ")
  return [line, cityLine, a.country].filter(Boolean).join(", ") || "N/A"
}

// Resolves the real customer a Shopify order should be billed to — creating
// one from the order's buyer info the first time, and matching the same
// person on repeat orders instead of piling everything onto one generic
// placeholder. Shopify's own customer id is the preferred match key (stable
// across an email change); email is the fallback for guest checkouts with no
// Shopify customer account.
async function resolveBuyerCustomerId(admin: AdminClient, order: ShopifyOrder): Promise<string> {
  const shopifyCustomerId = order.customer?.id ? String(order.customer.id) : null
  const email = (order.customer?.email || order.email || "").trim().toLowerCase() || null
  const firstName = order.customer?.first_name || order.billing_address?.first_name || ""
  const lastName = order.customer?.last_name || order.billing_address?.last_name || ""
  const fullName = `${firstName} ${lastName}`.trim() || email || `Shopify Customer #${order.order_number}`
  const phone = order.customer?.phone || order.phone || order.billing_address?.phone || "N/A"

  if (shopifyCustomerId) {
    const { data: existing } = await admin
      .from("customers")
      .select("id, email")
      .eq("shopify_customer_id", shopifyCustomerId)
      .maybeSingle()
    if (existing) return existing.id
  }

  if (email) {
    const { data: existing } = await admin
      .from("customers")
      .select("id, shopify_customer_id")
      .eq("is_shopify_customer", true)
      .eq("email", email)
      .maybeSingle()
    if (existing) {
      // Backfill the Shopify customer id if this buyer previously checked
      // out as a guest and has since created (or logged into) an account.
      if (shopifyCustomerId && !existing.shopify_customer_id) {
        await admin.from("customers").update({ shopify_customer_id: shopifyCustomerId }).eq("id", existing.id)
      }
      return existing.id
    }
  }

  // New buyer — create a real customer record. Contract fields are
  // structurally meaningless for an online order (no installed unit), so
  // they're filled with inert values; is_shopify_customer keeps this out of
  // Contracts/Quarterly Monitoring regardless of what's in them.
  const orderDate = order.created_at.slice(0, 10)
  const { data: created, error } = await admin
    .from("customers")
    .insert({
      full_name: fullName,
      email: email || `order-${order.id}@shopify.local`,
      contact_number: phone,
      address: formatBillingAddress(order),
      dispenser_type: "N/A",
      filter_installed: false,
      assigned_technician: "N/A",
      contract_start: orderDate,
      // Structurally meaningless (no real contract), but a far-future date
      // keeps the Customers list' contract-status badge reading "Active"
      // instead of a misleading "Expired" on someone who never had one.
      contract_end: `${Number(orderDate.slice(0, 4)) + 100}${orderDate.slice(4)}`,
      is_shopify_customer: true,
      shopify_customer_id: shopifyCustomerId,
      notes: "Auto-created from a Shopify order — no installed unit, not part of quarterly maintenance tracking.",
    })
    .select("id")
    .single()
  if (error || !created) throw new Error(error?.message ?? "Failed to create Shopify buyer customer")
  return created.id
}

export async function POST(request: Request) {
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  const expectedShop = process.env.SHOPIFY_SHOP_DOMAIN
  if (!clientSecret || !expectedShop) {
    // A config problem on our end, not the sender's — 500 so Shopify retries
    // once the env vars are actually set.
    return NextResponse.json({ error: "Server not configured" }, { status: 500 })
  }

  // Read the raw body FIRST — HMAC verification needs the exact bytes Shopify
  // sent, before any JSON parsing.
  const rawBody = await request.text()
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256")
  if (!verifyWebhookHmac(rawBody, hmacHeader, clientSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  const shopHeader = request.headers.get("x-shopify-shop-domain")
  if (shopHeader && shopHeader !== expectedShop) {
    return NextResponse.json({ error: "Unexpected shop" }, { status: 401 })
  }

  const order = JSON.parse(rawBody) as ShopifyOrder

  // Cancelled orders never shipped — nothing to deduct.
  if (order.cancelled_at) {
    return NextResponse.json({ ok: true, skipped: "cancelled" })
  }

  const admin = createAdminClient()
  const shopifyOrderId = String(order.id)

  // Idempotency: Shopify's webhook delivery is "at least once", so the same
  // order can arrive more than once (retries, redeliveries). Only ever
  // process it the first time.
  const { data: existing } = await admin.from("sales").select("id").eq("shopify_order_id", shopifyOrderId).maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, skipped: "duplicate" })
  }

  const { data: settings } = await admin.from("shopify_settings").select("system_profile_id").eq("id", 1).single()
  if (!settings?.system_profile_id) {
    // Config gap (e.g. OAuth install hasn't finished) — 500 so Shopify keeps
    // retrying within its retry window until the store is fully connected.
    return NextResponse.json({ error: "Shopify integration not fully configured" }, { status: 500 })
  }

  const matched: { productId: string; sku: string; quantity: number; unitPrice: number; subtotal: number }[] = []
  const unmatchedSkus: string[] = []

  for (const item of order.line_items) {
    const sku = item.sku?.trim()
    if (!sku) {
      unmatchedSkus.push(item.title || "(no SKU)")
      continue
    }
    const { data: product } = await admin.from("products").select("id").eq("sku", sku).maybeSingle()
    if (!product) {
      unmatchedSkus.push(sku)
      continue
    }
    // item.price is Shopify's PRE-discount unit price — subtract this line's
    // own allocated discount to get what the customer actually paid for it,
    // not the product's list price.
    const grossPrice = Number(item.price) || 0
    const lineDiscount = Number(item.total_discount) || 0
    const subtotal = Math.max(grossPrice * item.quantity - lineDiscount, 0)
    const unitPrice = item.quantity > 0 ? subtotal / item.quantity : grossPrice
    matched.push({
      productId: product.id,
      sku,
      quantity: item.quantity,
      unitPrice,
      subtotal,
    })
  }

  if (unmatchedSkus.length > 0) {
    await admin.from("notifications").insert({
      type: "shopify-sku-not-found",
      message: `Shopify order #${order.order_number} has ${unmatchedSkus.length} item(s) that don't match any product SKU: ${unmatchedSkus.join(", ")}.`,
      related_entity_id: shopifyOrderId,
    })
  }

  if (matched.length === 0) {
    // Nothing to deduct — the unmatched-SKU notification above is the only
    // record of this order.
    return NextResponse.json({ ok: true, skipped: "no matching SKUs" })
  }

  // Match this order to a real customer by name/email/phone (creating one
  // the first time this buyer orders) instead of billing every order to one
  // generic placeholder. Resolved here (only once we know a Sale will
  // actually be created) so a fully-unmatched order doesn't leave behind an
  // orphaned customer record with no purchase attached to it.
  let customerId: string
  try {
    customerId = await resolveBuyerCustomerId(admin, order)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve buyer customer" },
      { status: 500 }
    )
  }

  // Each matched item's subtotal above is already net of its own line-item
  // discount, so the discount is already fully baked into grossOfMatched —
  // no separate order-level subtraction here, or it would double-count.
  const grossOfMatched = matched.reduce((sum, m) => sum + m.subtotal, 0)
  // Shipping is charged on top of the goods — capture it so the invoice total
  // matches what Shopify actually billed (subtotal - discount + shipping).
  const shipping = shopifyShippingAmount(order)

  const { data: sale, error: saleError } = await admin
    .from("sales")
    .insert({
      date: order.created_at.slice(0, 10),
      customer_id: customerId,
      sales_rep_id: settings.system_profile_id,
      discount: 0,
      shipping,
      total_amount: grossOfMatched + shipping,
      payment_method: SHOPIFY_PAYMENT_METHOD,
      payment_status: mapShopifyPaymentStatus(order.financial_status),
      shopify_order_id: shopifyOrderId,
    })
    .select("id")
    .single()
  if (saleError || !sale) {
    return NextResponse.json({ error: saleError?.message ?? "Failed to create sale" }, { status: 500 })
  }

  // Each insert fires the same DB trigger a manual sale uses, which deducts
  // stock and records a "Sale" stock movement — no separate stock-deduction
  // code needed here.
  const { error: itemsError } = await admin.from("sale_items").insert(
    matched.map((m) => ({
      sale_id: sale.id,
      product_id: m.productId,
      quantity: m.quantity,
      unit_price: m.unitPrice,
      subtotal: m.subtotal,
    }))
  )
  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, saleId: sale.id, matchedItems: matched.length, unmatchedSkus })
}
