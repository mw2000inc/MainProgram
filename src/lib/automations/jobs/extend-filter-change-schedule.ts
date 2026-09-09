import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AutomationResult } from "../types"

// Same rolling-window idea as runExtendCollectionSchedule, for the Filter
// Change recurring schedule (see the filter_change_recurring_schedule and
// filter_change_cp_system_interval migrations) — extend_filter_change_
// schedule_window() paces each entry on its own linked CP System interval
// where one exists, the flat 3-month default otherwise.
export async function runExtendFilterChangeSchedule(): Promise<AutomationResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("extend_filter_change_schedule_window")
  if (error) return { ok: false, message: error.message }

  const rows = (data ?? []) as { out_sale_list_entry_id: string; out_occurrences_added: number }[]
  const totalOccurrencesAdded = rows.reduce((sum, r) => sum + r.out_occurrences_added, 0)
  return {
    ok: true,
    message: `Extended ${rows.length} entries, +${totalOccurrencesAdded} occurrences.`,
    detail: { entriesExtended: rows.length, totalOccurrencesAdded },
  }
}
