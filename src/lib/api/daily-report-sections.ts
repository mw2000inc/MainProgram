import { supabase } from "@/lib/supabase/client"
import type { DailyReportSectionConfig, DailyReportSectionKey } from "@/lib/types"

type Row = {
  section_key: DailyReportSectionKey
  label: string
  enabled: boolean
  display_order: number
  visible_fields: string[] | null
}

function fromRow(row: Row): DailyReportSectionConfig {
  return {
    sectionKey: row.section_key,
    label: row.label,
    enabled: row.enabled,
    displayOrder: row.display_order,
    visibleFields: row.visible_fields ?? [],
  }
}

export async function listDailyReportSections(): Promise<DailyReportSectionConfig[]> {
  const { data, error } = await supabase
    .from("daily_report_sections")
    .select("*")
    .order("display_order", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function updateDailyReportSection(
  sectionKey: DailyReportSectionKey,
  input: Partial<Omit<DailyReportSectionConfig, "sectionKey">>
): Promise<DailyReportSectionConfig> {
  const row: Record<string, unknown> = {}
  if (input.label !== undefined) row.label = input.label
  if (input.enabled !== undefined) row.enabled = input.enabled
  if (input.displayOrder !== undefined) row.display_order = input.displayOrder
  if (input.visibleFields !== undefined) row.visible_fields = input.visibleFields

  const { data, error } = await supabase
    .from("daily_report_sections")
    .update(row)
    .eq("section_key", sectionKey)
    .select()
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

// Persists a full reordering in one round trip — display_order becomes each
// key's index in the given array.
export async function reorderDailyReportSections(order: DailyReportSectionKey[]): Promise<void> {
  const results = await Promise.all(
    order.map((sectionKey, i) =>
      supabase.from("daily_report_sections").update({ display_order: i + 1 }).eq("section_key", sectionKey)
    )
  )
  const failed = results.find((r) => r.error)
  if (failed?.error) throw failed.error
}
