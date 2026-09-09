// One id per registered automation — the single shared vocabulary every
// piece of the hub (config defaults, the registry, the engine, the
// automation_runs audit table, the Settings toggle UI, the manual-trigger
// API route) refers to the same job by. Adding a new automation means
// adding one entry here, one in AUTOMATION_DEFAULTS (config.ts), and one in
// AUTOMATIONS (registry.ts) — TypeScript then flags anywhere those three
// fall out of sync.
export type AutomationId =
  | "extendCollectionSchedule"
  | "extendFilterChangeSchedule"
  | "generateFilterChangeJobs"
  | "filterChangeInventoryDeduction"

// What actually invoked this run — surfaced in automation_runs.detail so
// "who/what triggered this" is answerable from the log alone, without
// needing to cross-reference which route called in.
export interface AutomationContext {
  triggeredBy: "cron" | "manual"
  // The admin's own id, only present for a manual trigger from the
  // Settings page (see /api/automations/trigger) — never a claim about who
  // triggered a cron run, which has no human behind it at all.
  triggeredByUserId?: string
}

// Every automation's run() resolves to this instead of throwing — the
// engine still catches an unexpected throw as a fallback (see engine.ts),
// but a well-behaved automation reports its own success/failure this way
// so partial/expected failures (e.g. "3 of 40 rows errored") can be
// reported as ok:false with detail, not treated as a crash.
export interface AutomationResult {
  ok: boolean
  message: string
  detail?: Record<string, unknown>
}

export interface AutomationDefinition {
  id: AutomationId
  label: string
  description: string
  // Falls back to AUTOMATION_DEFAULTS[id] in config.ts — kept here too so a
  // definition is self-describing on its own, without needing a second
  // lookup, wherever just the definition (not the resolved/overridden
  // enabled state) is in scope.
  defaultEnabled: boolean
  run: (ctx: AutomationContext) => Promise<AutomationResult>
}
