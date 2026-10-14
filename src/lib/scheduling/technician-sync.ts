import type { SupabaseClient } from "@supabase/supabase-js"
import { assignmentAccounts, crewOfTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"

// Record → job: a Serviceman / TH saved on a Filter Change, Installation,
// Collection or Repair record is given to its open schedule job (approved or
// draft) — EXACTLY the technicians picked (admin, 2026-10-14: a manual choice
// is never re-paired by the crew rule, which is for automatic assignment
// only), with both technicians' logins so it reaches each one's own Daily
// Report. Picking both Liteace crew members on a job with no vehicle sets the
// Liteace. The job → record direction is the database's
// (sync_schedule_job_changes_to_module, plus 20261104000000 on linking), and
// it writes the same pair back to the record. Used by the record save hooks
// (browser) and the Filter Change
// "Suggest Technician" apply (server) — the same db calls either way.
// Returns true when the job was changed.
export async function syncRecordTechniciansToJob(
  db: SupabaseClient,
  jobId: string | null | undefined,
  technician: string | null | undefined,
  technician2: string | null | undefined
): Promise<boolean> {
  if (!jobId) return false
  const { data: job } = await db.from("schedule_jobs").select("status, technician, technician_2, vehicle").eq("id", jobId).maybeSingle()
  if (!job || !["pending", "pending_approval"].includes(job.status)) return false
  const pair = normalizeTechnicianPair(technician ?? "", technician2 ?? "")
  const crew = crewOfTechnician(pair.primary)
  const isWholeCrew = !!crew && !!pair.secondary && [crew.primary, crew.secondary].every((m) => [pair.primary, pair.secondary].some((p) => p.toLowerCase() === m.toLowerCase()))
  if (pair.primary === (job.technician ?? "") && pair.secondary === (job.technician_2 ?? "")) return false
  const { data: profiles } = await db.from("profiles").select("id, name, role")
  const accounts = assignmentAccounts(((profiles ?? []) as { id: string; name: string | null; role: string }[]).map((p) => ({ id: p.id, name: p.name ?? "", role: p.role })))
  const ids = technicianAccountIds(pair.primary, pair.secondary, accounts)
  const { error } = await db
    .from("schedule_jobs")
    .update({
      technician: pair.primary,
      technician_2: pair.secondary || null,
      technician_user_id: ids.technicianUserId || null,
      technician_2_user_id: ids.technician2UserId || null,
      // The whole crew picked and no vehicle yet → its vehicle; otherwise the
      // vehicle stays as it was.
      ...(isWholeCrew && crew && !(job.vehicle ?? "").trim() ? { vehicle: crew.vehicle } : {}),
    })
    .eq("id", jobId)
  if (error) throw error
  return true
}
