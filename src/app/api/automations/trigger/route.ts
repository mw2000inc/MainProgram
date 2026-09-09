import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { runAutomation } from "@/lib/automations/engine"
import { listAutomations } from "@/lib/automations/registry"
import { resolveAutomationEnabled } from "@/lib/automations/config"
import type { AutomationId } from "@/lib/automations/types"

// The single manual entry point for the Automation Hub — Settings >
// Automations' own "Run now" buttons call this, and it runs the exact same
// runAutomation() every cron route already calls, so a manual run and a
// scheduled run are logged and behave identically. Every call here re-
// checks that the caller is a real, authenticated admin server-side (same
// pattern as /api/admin/users) — this is never trusted from a client-
// supplied id.
async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user: caller },
  } = await supabase.auth.getUser()
  if (!caller) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }

  const { data: callerProfile } = await supabase.from("profiles").select("role").eq("id", caller.id).single()
  if (callerProfile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Only admins can manage automations" }, { status: 403 }) }
  }
  return { callerId: caller.id }
}

// Lists every registered automation plus its currently-resolved enabled
// state (company_settings.automation_settings override, falling back to
// the automation's own code default) — powers the Settings > Automations
// toggle list without that page needing its own copy of the resolution
// logic.
export async function GET() {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const admin = createAdminClient()
  const { data: settingsRow, error } = await admin.from("company_settings").select("automation_settings").eq("id", 1).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const overrides = (settingsRow?.automation_settings as Partial<Record<string, boolean>>) ?? null
  const automations = listAutomations().map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    enabled: resolveAutomationEnabled(a.id, overrides),
  }))
  return NextResponse.json({ automations })
}

// Manually runs one registered automation right now, regardless of its own
// cron schedule — still respects the enabled/disabled toggle (a disabled
// automation reports "skipped", same as it would from its own cron route)
// since "run it manually" isn't meant to be a bypass of "I turned this
// off".
export async function POST(request: Request) {
  const auth = await requireAdmin()
  if ("error" in auth) return auth.error

  const body = await request.json().catch(() => null)
  const automationId = body?.automationId as AutomationId | undefined
  if (!automationId) {
    return NextResponse.json({ error: "automationId is required" }, { status: 400 })
  }

  const result = await runAutomation(automationId, { triggeredBy: "manual", triggeredByUserId: auth.callerId })
  return NextResponse.json(result)
}
