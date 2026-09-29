import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { clearScheduleForDate } from "@/lib/scheduling/clear-schedule"

// Same admin gate as the other schedule-jobs mutation routes — deletes
// schedule_jobs rows and blanks source-plan technician columns across three
// tables, so this needs the service-role client, not RLS.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can clear a schedule" }, { status: 403 }) }
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
  const result = await clearScheduleForDate(admin, body.targetDate)
  return NextResponse.json(result)
}
