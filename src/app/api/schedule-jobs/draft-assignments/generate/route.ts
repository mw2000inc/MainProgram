import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { generateDraftAssignmentsForDate } from "@/lib/scheduling/draft-assignments"

// Same admin gate as suggest-technician-apply/route.ts — geocoding writes
// onto customers.latitude/longitude and reads across three plan tables need
// the service-role client, so the caller's own admin role is checked here
// first rather than relying on RLS to reject a non-admin's request.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can generate draft assignments" }, { status: 403 }) }
  }
  return {}
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as { targetDate?: string } | null
  if (!body?.targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
    return NextResponse.json({ error: "targetDate ('YYYY-MM-DD') is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const drafts = await generateDraftAssignmentsForDate(admin, body.targetDate)
  return NextResponse.json({ drafts })
}
