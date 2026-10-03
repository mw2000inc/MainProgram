import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Public (no login), for the QR-scan portal's Service History: one customer's
// installation records — the one service type get_portal_profile() doesn't
// return. Same scoping as that RPC: the customer's own order number plus the
// orders on their Sale List entries, reached only through the customer id the
// QR code encodes. Returns service fields only (no notes, contacts or prices).
export async function GET(_request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Invalid customer" }, { status: 400 })

  const admin = createAdminClient()
  const { data: customer, error: customerError } = await admin.from("customers").select("id, order_number").eq("id", customerId).maybeSingle()
  if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const orders = new Set<string>()
  if (customer.order_number?.trim()) orders.add(customer.order_number.trim())
  let entriesQuery = admin.from("sale_list_entries").select("order_number").eq("customer_id", customerId)
  if (customer.order_number?.trim()) {
    entriesQuery = admin
      .from("sale_list_entries")
      .select("order_number")
      .or(`customer_id.eq.${customerId},and(customer_id.is.null,order_number.eq."${customer.order_number.trim().replace(/"/g, "")}")`)
  }
  const { data: entries, error: entriesError } = await entriesQuery
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 })
  for (const e of entries ?? []) if (e.order_number?.trim()) orders.add(e.order_number.trim())
  if (orders.size === 0) return NextResponse.json({ installations: [] }, { headers: { "Cache-Control": "no-store" } })

  const { data, error } = await admin
    .from("install_plans")
    .select("id, order_no, status, input_date, pre_installed_date, installed_date, model, serviceman, serviceman_2")
    .in("order_no", [...orders])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ installations: data ?? [] }, { headers: { "Cache-Control": "no-store" } })
}
