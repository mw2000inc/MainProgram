import { NextResponse } from "next/server"
import { runAutomation } from "@/lib/automations/engine"

export const dynamic = "force-dynamic"

// Retired from vercel.json's cron schedule (see the ct_filter_change_
// collection_inventory_link migration) — this route is left in place,
// callable manually (e.g. via curl with CRON_SECRET, or from Settings >
// Automations' "Run now" for the "Filter Change Inventory Deduction
// (legacy)" entry), purely for the older single-product-per-job path. The
// actual logic lives in the Automation Hub (src/lib/automations/jobs/
// filter-change-inventory-deduction.ts) — see that file's own comment for
// the full policy.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runAutomation("filterChangeInventoryDeduction", { triggeredBy: "cron" })
  return NextResponse.json(result)
}
