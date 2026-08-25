import { supabase } from "@/lib/supabase/client"
import type { DailyReportLayout, PanelSize } from "@/lib/types"

type Row = {
  user_id: string
  layout: string[]
  panel_sizes: Record<string, PanelSize>
  layout_mode: string
}

function fromRow(row: Row): DailyReportLayout {
  return {
    layout: row.layout ?? [],
    panelSizes: row.panel_sizes ?? {},
    layoutMode: row.layout_mode === "grid" ? "grid" : "stacked",
  }
}

// Each admin's own Daily Report layout — RLS-scoped to `user_id = auth.uid()`,
// so this only ever reads/writes the caller's own row (see
// 20260825020000_daily_report_layouts_per_user.sql).
export async function getMyDailyReportLayout(userId: string): Promise<DailyReportLayout | null> {
  const { data, error } = await supabase.from("daily_report_layouts").select("*").eq("user_id", userId).maybeSingle()
  if (error) throw error
  return data ? fromRow(data as Row) : null
}

export async function saveMyDailyReportLayout(userId: string, input: Partial<DailyReportLayout>): Promise<void> {
  const row: Record<string, unknown> = { user_id: userId }
  if (input.layout !== undefined) row.layout = input.layout
  if (input.panelSizes !== undefined) row.panel_sizes = input.panelSizes
  if (input.layoutMode !== undefined) row.layout_mode = input.layoutMode

  const { error } = await supabase.from("daily_report_layouts").upsert(row, { onConflict: "user_id" })
  if (error) throw error
}
