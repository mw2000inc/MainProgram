import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  applyTechnicianAssignmentsToJobs,
  type NewScheduleJob,
  type JobAssignment,
  type JobEdits,
} from "@/lib/scheduling/schedule-job-suggest"

// Writes exactly what the client sends — every assignment here is
// something the admin explicitly reviewed (and could have overridden) in
// the confirm dialog after suggest-technician-preview. Running this at all
// is the confirmation, same as clicking "Run now" on an automation.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can assign technicians" }, { status: 403 }) }
  }
  return {}
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as {
    assignments?: { jobId?: string; technician?: string; technician2?: string; changes?: JobEdits }[]
    newJobs?: Partial<NewScheduleJob>[]
  } | null
  const rawAssignments = Array.isArray(body?.assignments) ? body.assignments : []
  const rawNewJobs = Array.isArray(body?.newJobs) ? body.newJobs : []
  if (rawAssignments.length === 0 && rawNewJobs.length === 0) {
    return NextResponse.json({ error: "assignments or newJobs (non-empty array) is required" }, { status: 400 })
  }
  const assignments: JobAssignment[] = rawAssignments
    .filter((a): a is { jobId: string; technician: string; technician2?: string; changes?: JobEdits } => !!a.jobId && !!a.technician)
    .map((a) => ({ jobId: a.jobId, technician: a.technician, technician2: a.technician2, changes: a.changes }))
  // An errand (type "other", or no type) needs its description; a bundled
  // task of a real type doesn't.
  const newJobs: NewScheduleJob[] = rawNewJobs
    .filter(
      (e): e is NewScheduleJob =>
        !!e.technician && !!e.scheduledDate && ((!!e.jobType && e.jobType !== "other") || !!e.notes?.trim())
    )
    .map((e) => ({
      jobType: e.jobType,
      customerId: e.customerId,
      orderNo: e.orderNo,
      technician: e.technician,
      technician2: e.technician2,
      scheduledDate: e.scheduledDate,
      scheduledTime: e.scheduledTime,
      address: e.address,
      notes: e.notes ?? "",
      filterCodes: e.filterCodes,
    }))
  if (assignments.length === 0 && newJobs.length === 0) {
    return NextResponse.json(
      { error: "Nothing valid to save (each job needs a technician; each new job needs a technician and date, and an errand also a description)" },
      { status: 400 }
    )
  }

  const admin = createAdminClient()
  const result = await applyTechnicianAssignmentsToJobs(admin, assignments, newJobs)
  return NextResponse.json(result)
}
