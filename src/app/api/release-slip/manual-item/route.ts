import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// A Release Slip "Add Item / Task" row → a pending Inventory movement, so it
// shows in the Inventory List for an admin to approve (POST), and its removal
// takes the still-pending movement back out (DELETE ?id=). Admins act for any
// technician; a technician only for their own slip. Reason 'Release Slip',
// dated the slip's date; the reference is the order number when the note
// names one ("001-0285 — Marlo Gonzales"), else "Release Slip". Matched to a
// product by SKU (the code before " / "), else queued unmapped (item_label).

async function caller() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  return { id: user.id, role: profile?.role as string | undefined }
}

export async function POST(request: Request) {
  const me = await caller()
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  if (me.role !== "admin" && me.role !== "technician") return NextResponse.json({ error: "Not allowed" }, { status: 403 })
  const body = (await request.json().catch(() => null)) as {
    date?: string
    technicianUserId?: string
    item?: { item?: string; direction?: "out" | "in"; qty?: number; note?: string }
  } | null
  const item = body?.item
  const label = (item?.item ?? "").trim()
  const qty = Math.max(0, Math.floor(Number(item?.qty) || 0))
  if (!body?.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !label || !qty) {
    return NextResponse.json({ error: "date, item and quantity are required" }, { status: 400 })
  }
  const technicianUserId = me.role === "admin" ? body.technicianUserId : me.id
  if (!technicianUserId) return NextResponse.json({ error: "Pick a technician first" }, { status: 400 })

  const db = createAdminClient()
  const sku = label.split(" / ")[0].trim()
  const { data: products } = await db.from("products").select("id").eq("sku", sku).order("date_added", { ascending: true }).limit(1)
  const productId = (products ?? [])[0]?.id ?? null
  const order = (item?.note ?? "").match(/\b\d{3}-\d{4}\b/)?.[0]
  const { data, error } = await db
    .from("stock_movements")
    .insert({
      date: body.date,
      product_id: productId,
      item_label: productId ? null : label,
      quantity_removed: item?.direction === "in" ? 0 : qty,
      quantity_added: item?.direction === "in" ? qty : 0,
      reason: "Release Slip",
      user_id: me.id,
      reference_number: order ?? "Release Slip",
      status: "pending",
    })
    .select("id")
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}

export async function DELETE(request: Request) {
  const me = await caller()
  if (!me) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const id = new URL(request.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
  const db = createAdminClient()
  const { data: row } = await db.from("stock_movements").select("id, status, reason, user_id").eq("id", id).maybeSingle()
  if (!row) return NextResponse.json({ ok: true })
  if (row.reason !== "Release Slip") return NextResponse.json({ error: "Not a Release Slip item" }, { status: 400 })
  if (me.role !== "admin" && row.user_id !== me.id) return NextResponse.json({ error: "Not allowed" }, { status: 403 })
  // Already approved or rejected: it stays (stock history is never rewritten).
  if (row.status !== "pending") return NextResponse.json({ ok: true, kept: row.status })
  const { error } = await db.from("stock_movements").delete().eq("id", id).eq("status", "pending")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
