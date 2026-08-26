import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// Creating a user with a set password is a privileged operation (requires the
// service-role key), so it has to happen server-side. This route re-checks
// that the caller is an authenticated admin before touching anything.
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single()
  if (callerProfile?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create users" }, { status: 403 })
  }

  const body = await request.json()
  const { name, email, password, role } = body as {
    name: string
    email: string
    password: string
    role: "admin" | "technician"
  }
  if (!name || !email || !password || password.length < 6) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }

  const admin = createAdminClient()
  // role goes in app_metadata, not user_metadata — app_metadata can only be
  // set here, via the privileged service-role Admin API. The public
  // signUp() method (anon key, used by /login's self-signup) has no
  // app_metadata parameter at all — verified against @supabase/auth-js's
  // own SignUpWithPasswordCredentials type, which only exposes `data`
  // (-> user_metadata). handle_new_user() reads role from app_metadata
  // specifically so a self-signup can never choose it by sending a crafted
  // `data: { role: "technician" }` payload straight to supabase.auth.signUp()
  // — user_metadata is trusted for `name` only, never for role.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role },
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ id: data.user.id })
}
