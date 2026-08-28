import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Runs on a schedule (see vercel.json) — both the recurring Collection
// schedule and the recurring Filter Change schedule are rolling windows
// (see the collection_schedule_rolling_window and
// filter_change_recurring_schedule migrations): each always covers
// "today + 2 years" ahead rather than being capped at CP End, so as today
// advances, previously-out-of-window occurrences come into range and need
// generating. This just calls the actual logic, which lives in the database
// (extend_collection_schedule_window() / extend_filter_change_schedule_
// window()) — both purely additive, never touch an existing occurrence
// (admin-edited or not), only add ones that are newly within the window.
// Both share this one cron entry rather than getting a second one, since
// Vercel's Hobby plan caps the number of cron jobs a project can have.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const [{ data: collectionRows, error: collectionError }, { data: filterChangeRows, error: filterChangeError }] =
    await Promise.all([
      admin.rpc("extend_collection_schedule_window"),
      admin.rpc("extend_filter_change_schedule_window"),
    ])
  if (collectionError) return NextResponse.json({ error: collectionError.message }, { status: 500 })
  if (filterChangeError) return NextResponse.json({ error: filterChangeError.message }, { status: 500 })

  const rows = (collectionRows ?? []) as { out_sale_list_entry_id: string; out_occurrences_added: number }[]
  const fcRows = (filterChangeRows ?? []) as { out_sale_list_entry_id: string; out_occurrences_added: number }[]
  return NextResponse.json({
    collection: {
      entriesExtended: rows.length,
      totalOccurrencesAdded: rows.reduce((sum, r) => sum + r.out_occurrences_added, 0),
    },
    filterChange: {
      entriesExtended: fcRows.length,
      totalOccurrencesAdded: fcRows.reduce((sum, r) => sum + r.out_occurrences_added, 0),
    },
  })
}
