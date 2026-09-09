// Thin client for /api/automations/trigger — the browser-side half of the
// Automation Hub. Listing/toggling which automations exist and what they're
// called comes from here (the registry itself lives server-only, see
// src/lib/automations/registry.ts); actually turning one on/off is still a
// plain company_settings.automation_settings write through the existing
// useUpdateSettings() mutation (see the Settings > Automations panel),
// exactly like every other Settings field — this file is only for reading
// the registry's metadata and manually running one.

export interface AutomationListItem {
  id: string
  label: string
  description: string
  // Resolved server-side (override in company_settings.automation_settings,
  // falling back to the automation's own code default) — always the real
  // current state, not just this file's own guess at it.
  enabled: boolean
}

export interface AutomationRunResult {
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

export async function listAutomations(): Promise<AutomationListItem[]> {
  const res = await fetch("/api/automations/trigger")
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? "Failed to load automations")
  return body.automations as AutomationListItem[]
}

export async function triggerAutomation(automationId: string): Promise<AutomationRunResult> {
  const res = await fetch("/api/automations/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ automationId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error ?? "Failed to run automation")
  return body as AutomationRunResult
}
