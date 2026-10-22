import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { canManagePasswords, MIN_PASSWORD_LENGTH } from "@/lib/password-manager"
import { recallPassword, rememberPassword } from "@/lib/password-vault"

// Cashout only (password-manager.ts), checked here on the server:
// GET  → the account's current password, if it was set through the app
//        (the encrypted copy in password_vault), else { password: null }.
// POST → sets a new password for any admin or technician account and keeps
//        its encrypted copy. Never logged.
async function requirePasswordManager() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  if (!canManagePasswords(caller.id)) return { error: NextResponse.json({ error: "Only cashout can change passwords" }, { status: 403 }) }
  return { callerId: caller.id }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requirePasswordManager()
  if ("error" in check) return check.error
  const { id } = await params
  const known = await recallPassword(createAdminClient(), id)
  return NextResponse.json(known ?? { password: null, setAt: null })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requirePasswordManager()
  if ("error" in check) return check.error

  const { id } = await params
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const password = typeof body?.password === "string" ? body.password : ""
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `The password needs at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 })
  }
  if (password !== password.trim()) return NextResponse.json({ error: "The password can't start or end with a space" }, { status: 400 })

  const admin = createAdminClient()
  const { data: profile } = await admin.from("profiles").select("id").eq("id", id).maybeSingle()
  if (!profile) return NextResponse.json({ error: "Account not found" }, { status: 404 })
  const { error } = await admin.auth.admin.updateUserById(id, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await rememberPassword(admin, id, password, check.callerId)
  // Who changed it, for the activity log (the password itself isn't recorded).
  await admin.from("profiles").update({ updated_by: check.callerId }).eq("id", id)
  return NextResponse.json({ ok: true })
}
