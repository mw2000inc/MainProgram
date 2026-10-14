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

// Filter Change → Collection: a member's Filter Change visit and its
// Collection on the same order and date are one trip, so the Collection is
// done by the Filter Change's technicians (admin, 2026-10-14). Each is still
// its own record with its own schedule job, so the pair is copied to every
// open Collection on that order and date (not collected, no Acc D) and on to
// its job, logins included. Returns how many Collections were changed.
export async function syncFilterChangeTechniciansToCollections(
  db: SupabaseClient,
  orderNo: string | null | undefined,
  date: string | null | undefined,
  technician: string | null | undefined,
  technician2: string | null | undefined
): Promise<number> {
  if (!orderNo?.trim() || !date) return 0
  const pair = normalizeTechnicianPair(technician ?? "", technician2 ?? "")
  const { data: rows, error } = await db
    .from("collections")
    .select("id, serviceman, serviceman_2, schedule_job_id")
    .eq("order_no", orderNo.trim())
    .eq("collection_date", date)
    .eq("status", "Pending")
    .eq("collected", false)
    .is("acc_d", null)
  if (error) throw error
  let changed = 0
  for (const row of (rows ?? []) as { id: string; serviceman: string | null; serviceman_2: string | null; schedule_job_id: string | null }[]) {
    if ((row.serviceman ?? "") === pair.primary && (row.serviceman_2 ?? "") === pair.secondary) continue
    const { error: updateError } = await db.from("collections").update({ serviceman: pair.primary, serviceman_2: pair.secondary }).eq("id", row.id)
    if (updateError) throw updateError
    await syncRecordTechniciansToJob(db, row.schedule_job_id, pair.primary, pair.secondary)
    changed += 1
  }
  return changed
}

// The technicians of the open Filter Change visit (Pending, no Acc D) on this
// order and date — what a new Collection on the same trip starts with. Null
// when there's no such visit or nobody is assigned to it yet.
export async function filterChangeTechniciansFor(
  db: SupabaseClient,
  orderNo: string | null | undefined,
  date: string | null | undefined
): Promise<{ primary: string; secondary: string } | null> {
  if (!orderNo?.trim() || !date) return null
  const { data } = await db
    .from("filter_change_plans")
    .select("serviceman, serviceman_2")
    .eq("order_number", orderNo.trim())
    .eq("plan_date", date)
    .eq("status", "Pending")
    .is("acc_d", null)
    .neq("serviceman", "")
    .limit(1)
  const row = (data ?? [])[0] as { serviceman: string | null; serviceman_2: string | null } | undefined
  if (!row?.serviceman?.trim()) return null
  return normalizeTechnicianPair(row.serviceman, row.serviceman_2 ?? "")
}
