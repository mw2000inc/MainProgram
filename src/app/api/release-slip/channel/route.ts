import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { SLIP_CHANNELS, channelReference, parseChannelReference, type SlipChannel } from "@/lib/release-slip-channels"

// The Shopee / Lazada Release Slip (admin only): each online order's items
// are Inventory movements with reason 'Shopee' / 'Lazada', dated the slip's
// date, reference "<order no.> — <buyer>" — pending, for an admin to approve
// in the Inventory List like every other slip item.
//
// GET ?date=&channel=  → that day's orders with their items.
// POST { date, channel, orders: [{ orderNo, previousOrderNo?, accountName, items }] }
//   Each order is saved as typed: its pending items are replaced by the ones
//   on the slip (beyond what's already approved — approved stock stays), its
//   buyer name is written to all its items, and a renamed order's old items
//   are moved. An order with no items has its pending items removed.

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") return { error: NextResponse.json({ error: "Only admins can use the Shopee / Lazada slip" }, { status: 403 }) }
  return { userId: user.id }
}

const validChannel = (c: unknown): c is SlipChannel => typeof c === "string" && (SLIP_CHANNELS as readonly string[]).includes(c)
const validDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)

type Move = {
  id: string
  product_id: string | null
  item_label: string | null
  quantity_added: number
  quantity_removed: number
  status: string
  reference_number: string | null
  created_at: string
  products: { sku: string | null } | null
}

async function dayMoves(date: string, channel: SlipChannel) {
  const { data, error } = await createAdminClient()
    .from("stock_movements")
    .select("id, product_id, item_label, quantity_added, quantity_removed, status, reference_number, created_at, products(sku)")
    .eq("reason", channel)
    .eq("date", date)
    .neq("status", "rejected")
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Move[]
}
const codeOf = (m: Move) => (m.products?.sku ?? "").trim() || (m.item_label ?? "").trim()

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const params = new URL(request.url).searchParams
  const date = params.get("date")
  const channel = params.get("channel")
  if (!validDate(date) || !validChannel(channel)) return NextResponse.json({ error: "date and channel are required" }, { status: 400 })
  try {
    // One order per order number, in the order they were first added.
    const orders = new Map<string, { orderNo: string; accountName: string; movements: { sku: string; label: string; qtyOut: number; qtyIn: number; status: string }[] }>()
    for (const m of await dayMoves(date, channel)) {
      const { orderNo, accountName } = parseChannelReference(m.reference_number)
      const o = orders.get(orderNo) ?? { orderNo, accountName, movements: [] }
      if (!o.accountName && accountName) o.accountName = accountName
      const code = codeOf(m)
      // Same code, direction and status → one line (quantities added up).
      for (const [out, back] of [
        [m.quantity_removed || 0, 0],
        [0, m.quantity_added || 0],
      ]) {
        if (!out && !back) continue
        const line = o.movements.find((l) => l.sku === code && l.status === m.status && !!l.qtyOut === !!out)
        if (line) {
          line.qtyOut += out
          line.qtyIn += back
        } else o.movements.push({ sku: code, label: code, qtyOut: out, qtyIn: back, status: m.status })
      }
      orders.set(orderNo, o)
    }
    return NextResponse.json({ orders: [...orders.values()] })
  } catch (e) {
    return NextResponse.json({ error: (e as { message?: string } | null)?.message || "Couldn't load the slip" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error
  const body = (await request.json().catch(() => null)) as {
    date?: unknown
    channel?: unknown
    orders?: { orderNo?: string; previousOrderNo?: string; accountName?: string; items?: { sku?: string; qtyOut?: number; qtyIn?: number }[] }[]
  } | null
  if (!validDate(body?.date) || !validChannel(body?.channel) || !Array.isArray(body?.orders)) {
    return NextResponse.json({ error: "date, channel and orders are required" }, { status: 400 })
  }
  const date = body.date
  const channel = body.channel
  const db = createAdminClient()
  try {
    const { data: products } = await db.from("products").select("id, sku, date_added").order("date_added", { ascending: true })
    const productBySku = new Map<string, string>()
    for (const p of (products ?? []) as { id: string; sku: string | null }[]) {
      const sku = (p.sku ?? "").trim()
      if (sku && !productBySku.has(sku)) productBySku.set(sku, p.id)
    }
    let all = await dayMoves(date, channel)
    let saved = 0
    for (const o of body.orders) {
      const orderNo = (o.orderNo ?? "").trim()
      const previous = (o.previousOrderNo ?? "").trim()
      if (!orderNo && !previous) continue
      const reference = channelReference(orderNo || previous, o.accountName ?? "")
      const mine = all.filter((m) => {
        const ref = parseChannelReference(m.reference_number).orderNo
        return ref === orderNo || (!!previous && ref === previous)
      })
      // Order No. / buyer written to all its items (approved ones too).
      const rename = mine.filter((m) => m.reference_number !== reference).map((m) => m.id)
      if (rename.length) {
        const { error } = await db.from("stock_movements").update({ reference_number: reference, updated_by: auth.userId }).in("id", rename)
        if (error) throw error
      }
      // Pending items replaced by the slip's, beyond what's already approved.
      const approved = new Map<string, { out: number; in: number }>()
      for (const m of mine.filter((x) => x.status !== "pending")) {
        const a = approved.get(codeOf(m)) ?? { out: 0, in: 0 }
        a.out += m.quantity_removed || 0
        a.in += m.quantity_added || 0
        approved.set(codeOf(m), a)
      }
      const pendingIds = mine.filter((m) => m.status === "pending").map((m) => m.id)
      if (pendingIds.length) {
        const { error } = await db.from("stock_movements").delete().in("id", pendingIds).eq("status", "pending")
        if (error) throw error
      }
      const wanted = new Map<string, { out: number; in: number }>()
      for (const i of o.items ?? []) {
        const sku = (i.sku ?? "").trim()
        if (!sku) continue
        const w = wanted.get(sku) ?? { out: 0, in: 0 }
        w.out += Math.max(0, Math.floor(Number(i.qtyOut) || 0))
        w.in += Math.max(0, Math.floor(Number(i.qtyIn) || 0))
        wanted.set(sku, w)
      }
      const inserts: Record<string, unknown>[] = []
      for (const [sku, w] of wanted) {
        const a = approved.get(sku) ?? { out: 0, in: 0 }
        const productId = productBySku.get(sku) ?? null
        for (const [out, back] of [
          [Math.max(0, w.out - a.out), 0],
          [0, Math.max(0, w.in - a.in)],
        ]) {
          if (!out && !back) continue
          inserts.push({
            date,
            product_id: productId,
            item_label: productId ? null : sku,
            quantity_removed: out,
            quantity_added: back,
            reason: channel,
            user_id: auth.userId,
            reference_number: reference,
            status: "pending",
          })
        }
      }
      if (inserts.length) {
        const { error } = await db.from("stock_movements").insert(inserts)
        if (error) throw error
      }
      saved += 1
      all = await dayMoves(date, channel)
    }
    return NextResponse.json({ saved })
  } catch (e) {
    return NextResponse.json({ error: (e as { message?: string } | null)?.message || "Save failed" }, { status: 500 })
  }
}
