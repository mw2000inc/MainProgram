import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { completeScheduleJobs } from "@/lib/scheduling/complete-jobs"

// Batch "Mark as Completed" from the Schedule full-screen view — admin only.
// Uses the service-role client because it also completes the linked Filter
// Change / install / repair records and queues inventory movements (see
// completeScheduleJobs).
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can complete jobs in bulk" }, { status: 403 }) }
  }
  return { callerId: caller.id }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as { jobIds?: unknown; today?: string } | null
  const jobIds = Array.isArray(body?.jobIds) ? body.jobIds.filter((id): id is string => typeof id === "string" && id.length > 0) : []
  if (jobIds.length === 0) return NextResponse.json({ error: "jobIds (non-empty array) is required" }, { status: 400 })
  if (!body?.today || !/^\d{4}-\d{2}-\d{2}$/.test(body.today)) {
    return NextResponse.json({ error: "today ('YYYY-MM-DD') is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  try {
    const result = await completeScheduleJobs(admin, jobIds, body.today, auth.callerId)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to complete jobs" }, { status: 500 })
  }
}
