import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can manage users" }, { status: 403 }) }
  }
  return { callerId: caller.id }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAdmin()
  if (check.error) return check.error

  const { id } = await params
  const admin = createAdminClient()
  // Stamped just before the delete (not after — the row won't exist to
  // update once auth.users cascades) so the audit trigger's fallback for
  // this service-role path (no auth.uid()) attributes the deletion to the
  // admin who actually requested it, verified server-side above, rather
  // than whoever last edited this profile for an unrelated reason.
  await admin.from("profiles").update({ updated_by: check.callerId }).eq("id", id)
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
