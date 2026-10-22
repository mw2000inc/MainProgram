import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { forgetPassword } from "@/lib/password-vault"

// Called after someone sets their own new password (Forgot password →
// /reset-password): cashout's saved copy of it (password_vault) is now out of
// date, so it's deleted — the Users page then says it isn't known instead of
// showing a wrong one. Only ever the caller's own entry.
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  await forgetPassword(createAdminClient(), user.id)
  return NextResponse.json({ ok: true })
}
