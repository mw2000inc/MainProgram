import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json) — the recurring Collection schedule
// is a rolling window (see the collection_schedule_rolling_window
// migration): it always covers "today + 2 years" ahead rather than being
// capped at CP End, so as today advances, previously-out-of-window
// occurrences come into range and need generating. This just calls the
// actual logic, which lives in the database (extend_collection_schedule_
// window()) — purely additive, never touches an existing occurrence
// (admin-edited or not), only adds ones that are newly within the window.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("extend_collection_schedule_window")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as { out_sale_list_entry_id: string; out_occurrences_added: number }[]
  return NextResponse.json({
    entriesExtended: rows.length,
    totalOccurrencesAdded: rows.reduce((sum, r) => sum + r.out_occurrences_added, 0),
  })
}
