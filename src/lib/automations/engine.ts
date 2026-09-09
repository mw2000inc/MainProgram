import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { AUTOMATIONS } from "./registry"
import { resolveAutomationEnabled } from "./config"
import type { AutomationContext, AutomationId, AutomationResult } from "./types"

// The single entry point every automated task runs through — every
// existing cron route and the manual /api/automations/trigger route alike
// (see each's own call site) — so enable/disable checking, timing, and
// audit logging can never drift between the two paths. Critically, this
// never lets an automation's own bug escape as a thrown exception: whatever
// happens inside definition.run(), the caller always gets back a normal
// AutomationResult, never an unhandled rejection — one broken automation
// can't crash a cron route's response or, if ever called from a page
// action, a real user-facing flow.
export async function runAutomation(id: AutomationId, ctx: AutomationContext): Promise<AutomationResult> {
  const admin = createAdminClient()
  const startedAt = Date.now()
  const definition = AUTOMATIONS[id]

  if (!definition) {
    const result: AutomationResult = { ok: false, message: `Unknown automation id: ${id}` }
    await logRun(admin, id, "error", result, Date.now() - startedAt, ctx)
    return result
  }

  let overrides: Partial<Record<string, boolean>> | null = null
  try {
    const { data } = await admin.from("company_settings").select("automation_settings").eq("id", 1).maybeSingle()
    overrides = (data?.automation_settings as Partial<Record<string, boolean>>) ?? null
  } catch {
    // Reading the toggle itself failed (e.g. the singleton row is missing)
    // — fall back to the automation's own code default rather than
    // blocking the run entirely over a settings-read hiccup.
    overrides = null
  }

  if (!resolveAutomationEnabled(id, overrides)) {
    const result: AutomationResult = { ok: true, message: "Skipped — disabled in Settings > Automations." }
    await logRun(admin, id, "skipped", result, Date.now() - startedAt, ctx)
    return result
  }

  try {
    const result = await definition.run(ctx)
    await logRun(admin, id, result.ok ? "success" : "error", result, Date.now() - startedAt, ctx)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    const result: AutomationResult = { ok: false, message }
    await logRun(admin, id, "error", result, Date.now() - startedAt, ctx)
    return result
  }
}

// Best-effort — logging must never be able to fail the automation it's
// logging, or mask the real result/error with a logging-table error
// instead. Swallows its own failure rather than throwing or being awaited
// by a caller that treats a logging error as the automation's own error.
async function logRun(
  admin: ReturnType<typeof createAdminClient>,
  automationId: string,
  status: "success" | "error" | "skipped",
  result: AutomationResult,
  durationMs: number,
  ctx: AutomationContext
): Promise<void> {
  try {
    await admin.from("automation_runs").insert({
      automation_id: automationId,
      status,
      message: result.message,
      detail: { ...result.detail, triggeredBy: ctx.triggeredBy, triggeredByUserId: ctx.triggeredByUserId ?? null },
      duration_ms: durationMs,
    })
  } catch {
    // Swallowed — see comment above.
  }
}
