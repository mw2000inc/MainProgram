import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { suggestTechnicianForPlan } from "@/lib/scheduling/filter-change-suggest"

// Read-only suggestion: never writes serviceman itself. The admin applies
// it (or edits it further) through the normal filter-change-form-dialog
// save path, same as any other manual edit — this only fills in the
// starting value. Same requireAdmin() shape as /api/automations/trigger.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can suggest technician assignments" }, { status: 403 }) }
  }
  return {}
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as { planId?: string } | null
  if (!body?.planId) {
    return NextResponse.json({ error: "planId is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const result = await suggestTechnicianForPlan(admin, body.planId)
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 422 })
  }
  return NextResponse.json(result)
}
