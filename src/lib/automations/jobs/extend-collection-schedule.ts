import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import type { AutomationResult } from "../types"

// The Collection recurring schedule is a rolling window (see the
// collection_schedule_rolling_window migration): it always covers
// "today + 2 years" ahead rather than being capped at CP End, so as today
// advances, previously-out-of-window occurrences come into range and need
// generating. This just calls the actual logic, which lives in the
// database (extend_collection_schedule_window()) — purely additive, never
// touches an existing occurrence (admin-edited or not), only adds ones
// newly within the window.
export async function runExtendCollectionSchedule(): Promise<AutomationResult> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("extend_collection_schedule_window")
  if (error) return { ok: false, message: error.message }

  const rows = (data ?? []) as { out_sale_list_entry_id: string; out_occurrences_added: number }[]
  const totalOccurrencesAdded = rows.reduce((sum, r) => sum + r.out_occurrences_added, 0)
  return {
    ok: true,
    message: `Extended ${rows.length} entries, +${totalOccurrencesAdded} occurrences.`,
    detail: { entriesExtended: rows.length, totalOccurrencesAdded },
  }
}
