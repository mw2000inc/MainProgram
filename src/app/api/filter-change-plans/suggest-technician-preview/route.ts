import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { previewSuggestionsForPlans } from "@/lib/scheduling/filter-change-suggest"

// Read-only: computes a suggestion per plan without writing anything, so
// the admin can review/edit each one in the confirm dialog before
// suggest-technician-apply actually saves anything (see
// filter-change-suggest.ts's own comment on the preview-then-apply split).
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

// A handful of not-yet-geocoded customers in the batch may each need a live
// Nominatim call (~1/sec, see nominatim-server.ts's fallback chain), hence
// the longer maxDuration — same reasoning the old bulk route had.
export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as { planIds?: string[] } | null
  if (!body?.planIds || !Array.isArray(body.planIds) || body.planIds.length === 0) {
    return NextResponse.json({ error: "planIds (non-empty array) is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const results = await previewSuggestionsForPlans(admin, body.planIds)
  return NextResponse.json({ results })
}
