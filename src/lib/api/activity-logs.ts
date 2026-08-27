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

// One day past the given yyyy-MM-dd, as an ISO instant — the exclusive upper
// bound for a UTC day-range filter (matches how activity_logs.created_at,
// and every other stored date/time in this app, is treated as UTC — see
// log_audit_event()'s `(now() at time zone 'utc')::date`).
function nextDayIso(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString()
}

// Shared by the Admin Activity and Technician Activity pages — same table,
// filtered by the acting user's role via an inner join so the split reflects
// who actually made the change, not which table they changed (schedule_jobs
// is now writable, in a narrow way, by both roles — see the
// technician_job_status_update migration). RLS restricts this to admins
// (see activity_logs_select_admin) either way — a technician's call here
// simply comes back empty, not an error.
async function listActivityLogsByRole(role: "admin" | "technician", date?: string): Promise<ActivityLogEntry[]> {
  let query = supabase
    .from("activity_logs")
    .select("*, actor:profiles!inner(name, role)")
    .eq("actor.role", role)
    .order("created_at", { ascending: false })
    .limit(500)
  if (date) {
    query = query.gte("created_at", `${date}T00:00:00.000Z`).lt("created_at", nextDayIso(date))
  }
  const { data, error } = await query
  if (error) throw error
  return (data as unknown as Row[]).map(fromRow)
}

export async function listActivityLogs(date?: string): Promise<ActivityLogEntry[]> {
  return listActivityLogsByRole("admin", date)
}

export async function listTechnicianActivityLogs(date?: string): Promise<ActivityLogEntry[]> {
  return listActivityLogsByRole("technician", date)
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
