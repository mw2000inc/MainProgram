import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { applyTechnicianAssignments } from "@/lib/scheduling/filter-change-suggest"

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

  const body = (await request.json().catch(() => null)) as { assignments?: { planId?: string; technician?: string }[] } | null
  if (!body?.assignments || !Array.isArray(body.assignments) || body.assignments.length === 0) {
    return NextResponse.json({ error: "assignments (non-empty array) is required" }, { status: 400 })
  }
  const assignments = body.assignments.filter((a): a is { planId: string; technician: string } => !!a.planId && !!a.technician)
  if (assignments.length === 0) {
    return NextResponse.json({ error: "No valid assignments (each needs planId and technician)" }, { status: 400 })
  }

  const admin = createAdminClient()
  const result = await applyTechnicianAssignments(admin, assignments)
  return NextResponse.json(result)
}
