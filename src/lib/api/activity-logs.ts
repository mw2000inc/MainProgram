import { supabase } from "@/lib/supabase/client"
import type { ActivityLogEntry } from "@/lib/types"

type Row = {
  id: string
  user_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  description: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  created_at: string
  actor: { name: string } | null
}

function fromRow(row: Row): ActivityLogEntry {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    userName: row.actor?.name ?? "Unknown",
    action: (row.action as ActivityLogEntry["action"]) ?? "update",
    entityType: row.entity_type ?? undefined,
    entityId: row.entity_id ?? undefined,
    description: row.description ?? undefined,
    oldValues: row.old_values ?? {},
    newValues: row.new_values ?? {},
    createdAt: row.created_at,
  }
}

// RLS restricts this to admins (see activity_logs_select_admin) — a
// technician's call here simply comes back empty, not an error.
export async function listActivityLogs(): Promise<ActivityLogEntry[]> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*, actor:profiles(name)")
    .order("created_at", { ascending: false })
    .limit(500)
  if (error) throw error
  return (data as unknown as Row[]).map(fromRow)
}

// Powers the inline "Last edited by X · date" indicator on a record's own
// page — the single most recent audit entry for that entity, if any.
export async function getLatestActivityForEntity(
  entityType: string,
  entityId: string
): Promise<ActivityLogEntry | null> {
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*, actor:profiles(name)")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? fromRow(data as unknown as Row) : null
}
