import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

// A warning / error pop-up someone saw (toast.warning / toast.error, or an
// inline warning like the duplicate Filter Change one) saved to the bell, so
// it stays after the pop-up is gone — shown to every admin, named with who
// saw it. The same message from the same person within 2 minutes is saved
// once. Any signed-in account may report its own; the row is written by the
// server (notifications has no insert policy for the browser). `href` — the
// in-app page it happened on — is kept in related_entity_id, so clicking the
// notification goes there (resolveNotificationTarget).
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { level?: unknown; message?: unknown; href?: unknown } | null
  const level = body?.level === "error" ? "error" : body?.level === "warning" ? "warning" : null
  const text = typeof body?.message === "string" ? body.message.replace(/\s+/g, " ").trim() : ""
  if (!level || !text) return NextResponse.json({ error: "level and message are required" }, { status: 400 })
  // Only a path inside this app ("/filter-change?id=…"), never another site.
  const href = typeof body?.href === "string" && /^\/(?!\/)/.test(body.href) ? body.href.slice(0, 500) : null

  const db = createAdminClient()
  const { data: profile } = await db.from("profiles").select("name").eq("id", user.id).maybeSingle()
  const who = (profile?.name as string | undefined)?.trim() || "Someone"
  const message = `${who}: ${text}`.slice(0, 500)

  const since = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: recent } = await db.from("notifications").select("id").eq("type", level).eq("message", message).gte("created_at", since).limit(1)
  if (recent?.length) return NextResponse.json({ ok: true, duplicate: true })

  const { error } = await db.from("notifications").insert({ type: level, message, related_entity_id: href })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
