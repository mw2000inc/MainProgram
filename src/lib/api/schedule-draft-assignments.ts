import { supabase } from "@/lib/supabase/client"

export type DraftEntityType = "filter_change_plans" | "collections" | "repair_plans"

export interface DraftAssignment {
  id: string
  entityType: DraftEntityType
  entityId: string
  targetDate: string
  proposedTechnician: string
  proposedTechnician2: string
  distanceKm: number | null
  nearbyCount: number
  explanation: string
  outsideCoverage: boolean
  createdAt: string
}

type DraftAssignmentRow = {
  id: string
  entity_type: DraftEntityType
  entity_id: string
  target_date: string
  proposed_technician: string
  proposed_technician_2: string
  distance_km: number | null
  nearby_count: number
  explanation: string
  outside_coverage: boolean
  created_at: string
}

function fromRow(row: DraftAssignmentRow): DraftAssignment {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    targetDate: row.target_date,
    proposedTechnician: row.proposed_technician,
    proposedTechnician2: row.proposed_technician_2,
    distanceKm: row.distance_km,
    nearbyCount: row.nearby_count,
    explanation: row.explanation,
    outsideCoverage: row.outside_coverage,
    createdAt: row.created_at,
  }
}

// Plain authenticated read, RLS-gated to admins (schedule_draft_assignments_admin_select)
// — no service-role needed just to list what a previous Generate run produced.
export async function listDraftAssignments(targetDate: string): Promise<DraftAssignment[]> {
  const { data, error } = await supabase.from("schedule_draft_assignments").select("*").eq("target_date", targetDate)
  if (error) throw error
  return ((data ?? []) as DraftAssignmentRow[]).map(fromRow)
}

// Runs the actual clustering (geocoding + cross-table reads), so this goes
// through the service-role API route rather than a direct client call — see
// draft-assignments.ts's own comment on why.
export async function generateDraftAssignments(targetDate: string): Promise<DraftAssignment[]> {
  const res = await fetch("/api/schedule-jobs/draft-assignments/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetDate }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to generate draft assignments")
  return (data.drafts as DraftAssignmentRow[]).map(fromRow)
}

// Writes the (possibly admin-edited) technician/technician_2 onto each
// draft's own source table and removes it from the queue — see
// approveDraftAssignments in draft-assignments.ts.
export async function approveDraftAssignments(
  drafts: { id: string; entityType: DraftEntityType; entityId: string; technician: string; technician2?: string }[]
): Promise<{ approved: number }> {
  const res = await fetch("/api/schedule-jobs/draft-assignments/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drafts }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? "Failed to approve draft assignments")
  return data as { approved: number }
}

// A plain delete under RLS (schedule_draft_assignments_admin_delete) — no
// source table is touched, so no service-role step is needed to discard a
// proposal the admin doesn't want.
export async function rejectDraftAssignments(ids: string[]): Promise<void> {
  const { error } = await supabase.from("schedule_draft_assignments").delete().in("id", ids)
  if (error) throw error
}
