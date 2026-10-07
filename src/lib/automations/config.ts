import type { AutomationId } from "./types"

// Code-level fallback for every registered automation — the source of
// truth only until an admin actually saves an override on the Settings >
// Automations panel (persisted in company_settings.automation_settings,
// see the automation_hub migration). A brand new automation added here
// later, that no admin has ever touched, correctly defaults to whatever
// this file says rather than silently starting disabled.
export const AUTOMATION_DEFAULTS: Record<AutomationId, boolean> = {
  extendCollectionSchedule: true,
  extendFilterChangeSchedule: true,
  // Retired from the daily cron: Filter Change jobs now come only from the
  // CP-derived Filter Change records (generateDraftJobs). Off unless an admin
  // switches it on in Settings > Automations to run it by hand.
  generateFilterChangeJobs: false,
  filterChangeInventoryDeduction: true,
  sendScheduleReminders: true,
  generateDraftJobs: true,
  redateShortNoticeDrafts: true,
}

// overrides is company_settings.automation_settings as-is (a plain jsonb
// object, keys not guaranteed to be valid AutomationIds if the column was
// ever hand-edited) — an explicit true/false always wins; a missing or
// unrecognized key falls back to this file's own default.
export function resolveAutomationEnabled(
  id: AutomationId,
  overrides: Partial<Record<string, boolean>> | null | undefined
): boolean {
  const override = overrides?.[id]
  return typeof override === "boolean" ? override : AUTOMATION_DEFAULTS[id]
}
