import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { approveDraftAssignments } from "@/lib/scheduling/draft-assignments"

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can approve draft assignments" }, { status: 403 }) }
  }
  return {}
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as {
    drafts?: { id?: string; entityType?: string; entityId?: string; technician?: string; technician2?: string }[]
  } | null
  if (!body?.drafts || !Array.isArray(body.drafts) || body.drafts.length === 0) {
    return NextResponse.json({ error: "drafts (non-empty array) is required" }, { status: 400 })
  }
  const drafts = body.drafts
    .filter(
      (d): d is { id: string; entityType: string; entityId: string; technician: string; technician2?: string } =>
        !!d.id && !!d.entityType && !!d.entityId && !!d.technician
    )
    .map((d) => ({ id: d.id, entityType: d.entityType, entityId: d.entityId, technician: d.technician, technician2: d.technician2 }))
  if (drafts.length === 0) {
    return NextResponse.json({ error: "No valid drafts (each needs id, entityType, entityId, technician)" }, { status: 400 })
  }

  const admin = createAdminClient()
  const result = await approveDraftAssignments(admin, drafts)
  return NextResponse.json(result)
}
