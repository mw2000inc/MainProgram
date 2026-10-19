import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// The SKU list for the Release Slip's SKU cells (pick from the list or type):
// each product's SKU and name, nothing else. Technicians can't read the
// products table themselves (admin-only RLS), so it's served here to admins
// and technicians only.
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin" && profile?.role !== "technician") return NextResponse.json({ error: "Not allowed" }, { status: 403 })

  const { data, error } = await createAdminClient().from("products").select("sku, name, date_added").order("date_added", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // One entry per SKU (the earliest added, like every queue), sorted 011, 012 …
  const seen = new Map<string, string>()
  for (const p of (data ?? []) as { sku: string | null; name: string | null }[]) {
    const sku = (p.sku ?? "").trim()
    if (sku && !seen.has(sku)) seen.set(sku, (p.name ?? "").trim())
  }
  const skus = [...seen].map(([sku, name]) => ({ sku, name })).sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
  return NextResponse.json({ skus })
}
