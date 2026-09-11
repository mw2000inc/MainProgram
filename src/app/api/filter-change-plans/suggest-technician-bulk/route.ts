import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { suggestAndAssignBulk } from "@/lib/scheduling/filter-change-suggest"

// Unlike the single-suggest route, this one writes serviceman directly —
// an admin explicitly triggering this batch run over a set of plans they're
// already looking at (see filter-change/page.tsx's month-scoped "Auto-
// suggest technicians" button) is the confirmation, the same way clicking
// "Run now" on an automation is. A handful of not-yet-geocoded customers in
// the batch may each need a live Nominatim call (~1/sec, see
// nominatim-server.ts's fallback chain), hence the longer maxDuration.
export const maxDuration = 60

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can auto-assign technicians" }, { status: 403 }) }
  }
  return {}
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as { planIds?: string[] } | null
  if (!body?.planIds || !Array.isArray(body.planIds) || body.planIds.length === 0) {
    return NextResponse.json({ error: "planIds (non-empty array) is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const results = await suggestAndAssignBulk(admin, body.planIds)

  const assigned = results.filter((r) => !("error" in r.result)).length
  const skipped = results.length - assigned
  const flaggedOutsideCoverage = results.filter((r) => !("error" in r.result) && r.result.outsideCoverage).length

  return NextResponse.json({ assigned, skipped, flaggedOutsideCoverage, results })
}
