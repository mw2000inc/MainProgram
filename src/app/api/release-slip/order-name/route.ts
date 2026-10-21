import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// The Accnt. Name for an Order No. typed on an added Release Slip row — the
// same order the slip names its jobs in (get_release_slip): the Sale List
// customer's company / full name, else the newest Filter Change, Collection,
// Installation or Repair record of that order. Served here because
// technicians can't read the Sale List or customers themselves.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin" && profile?.role !== "technician") return NextResponse.json({ error: "Not allowed" }, { status: 403 })

  const order = (new URL(request.url).searchParams.get("order") ?? "").trim()
  if (!order) return NextResponse.json({ name: "" })
  const db = createAdminClient()

  const { data: sale } = await db.from("sale_list_entries").select("customer_id").eq("order_number", order).not("customer_id", "is", null).limit(1)
  const customerId = (sale?.[0] as { customer_id?: string } | undefined)?.customer_id
  if (customerId) {
    const { data: c } = await db.from("customers").select("company_name, full_name").eq("id", customerId).maybeSingle()
    const name = ((c?.company_name as string | null) ?? "").trim() || ((c?.full_name as string | null) ?? "").trim()
    if (name) return NextResponse.json({ name })
  }

  const sources = [
    { table: "filter_change_plans", order: "order_number", name: "member_account" },
    { table: "collections", order: "order_no", name: "account_name" },
    { table: "install_plans", order: "order_no", name: "name" },
    { table: "repair_plans", order: "order_no", name: "account_name" },
  ]
  for (const s of sources) {
    const { data } = await db.from(s.table).select(s.name).eq(s.order, order).neq(s.name, "").order("created_at", { ascending: false }).limit(1)
    const name = (((data?.[0] as Record<string, string | null> | undefined)?.[s.name]) ?? "").trim()
    if (name) return NextResponse.json({ name })
  }
  return NextResponse.json({ name: "" })
}
