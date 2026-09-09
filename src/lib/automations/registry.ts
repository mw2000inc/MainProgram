import "server-only"
import type { AutomationDefinition, AutomationId } from "./types"
import { AUTOMATION_DEFAULTS } from "./config"
import { runExtendCollectionSchedule } from "./jobs/extend-collection-schedule"
import { runExtendFilterChangeSchedule } from "./jobs/extend-filter-change-schedule"
import { runGenerateFilterChangeJobs } from "./jobs/generate-filter-change-jobs"
import { runFilterChangeInventoryDeduction } from "./jobs/filter-change-inventory-deduction"

// One entry per automated background task in this app — the single place
// that maps an AutomationId to what it actually does. Every existing cron
// route (see src/app/api/cron/*/route.ts, now thin wrappers) and the manual
// /api/automations/trigger route both resolve a job through this same
// table via runAutomation() (engine.ts), so there's exactly one definition
// of what "extendCollectionSchedule" means, never two copies that could
// drift apart.
export const AUTOMATIONS: Record<AutomationId, AutomationDefinition> = {
  extendCollectionSchedule: {
    id: "extendCollectionSchedule",
    label: "Extend Collection Schedule Window",
    description: "Keeps the rolling Collection recurring-schedule window filled 2 years ahead (extend_collection_schedule_window).",
    defaultEnabled: AUTOMATION_DEFAULTS.extendCollectionSchedule,
    run: runExtendCollectionSchedule,
  },
  extendFilterChangeSchedule: {
    id: "extendFilterChangeSchedule",
    label: "Extend Filter Change Schedule Window",
    description: "Keeps the rolling Filter Change recurring-schedule window filled 2 years ahead (extend_filter_change_schedule_window).",
    defaultEnabled: AUTOMATION_DEFAULTS.extendFilterChangeSchedule,
    run: runExtendFilterChangeSchedule,
  },
  generateFilterChangeJobs: {
    id: "generateFilterChangeJobs",
    label: "Generate Due Filter Change Jobs",
    description: "Creates a Schedule job for every customer/CP-System-linked order whose next filter change is now due.",
    defaultEnabled: AUTOMATION_DEFAULTS.generateFilterChangeJobs,
    run: runGenerateFilterChangeJobs,
  },
  filterChangeInventoryDeduction: {
    id: "filterChangeInventoryDeduction",
    label: "Filter Change Inventory Deduction (legacy)",
    description: "Deducts stock for completed filter-change jobs using the older single-product-per-job fields. Retired from the daily cron; kept for manual use only.",
    defaultEnabled: AUTOMATION_DEFAULTS.filterChangeInventoryDeduction,
    run: runFilterChangeInventoryDeduction,
  },
}

export function listAutomations(): AutomationDefinition[] {
  return Object.values(AUTOMATIONS)
}
