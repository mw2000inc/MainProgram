import type { ActivityLogEntry } from "@/lib/types"

export type ActivityLogTarget =
  | { kind: "href"; href: string }
  | { kind: "unavailable"; message: string }

// Maps an audit log entry's entity_type (+ entity_id) to wherever that
// record is actually viewable in the app today — checked against the real
// routes/split-view patterns already in the codebase, not guessed:
//
//   * customers, sale_list_entries already have their own dynamic [id]
//     route, and both already render a graceful "not found" screen when the
//     id doesn't match anything — nothing extra needed for those two.
//   * schedule_jobs, filter_change_plans, collections, repair_plans,
//     install_plans, cp_systems, products, stock_movements, profiles all
//     live on a flat list page with a `?id=` deep-link convention
//     (useSplitViewSelection's `initialId`, or the page's own dialog-based
//     equivalent for the pages that don't use split-view) — see each page
//     for how it resolves (or reports as missing) that id once its data
//     loads.
//   * company_settings (a single row) and daily_report_sections (small,
//     always-fully-visible admin config) both live on /settings — no id
//     needed to find them once there.
//   * announcements only ever render on the dashboard's Daily Report.
//   * schedule_job_filter_items has no page of its own — it's a line item
//     on a schedule job's Filter Change checklist (see MarkJobDoneDialog),
//     so this routes to the parent job instead, using the schedule_job_id
//     captured in whichever values this entry actually recorded (the full
//     row on insert/delete; only the changed columns on update — and
//     schedule_job_id itself is never edited in place, so an update entry
//     may not carry it at all).
//   * suppliers and sales (the legacy invoice table, superseded by
//     sale_list_entries — nothing in the app reads or writes it anymore)
//     have no page at all: verified by searching the whole app directory,
//     not assumed.
export function resolveActivityLogTarget(entry: ActivityLogEntry): ActivityLogTarget | undefined {
  const { entityType, entityId } = entry
  if (!entityType || !entityId) return undefined

  switch (entityType) {
    case "customers":
      return { kind: "href", href: `/customers/${entityId}` }
    case "sale_list_entries":
      return { kind: "href", href: `/sale-list/${entityId}` }
    case "schedule_jobs":
      return { kind: "href", href: `/schedule?id=${entityId}` }
    case "filter_change_plans":
      return { kind: "href", href: `/filter-change?id=${entityId}` }
    case "collections":
      return { kind: "href", href: `/collection-plan?id=${entityId}` }
    case "repair_plans":
      return { kind: "href", href: `/repair-plan?id=${entityId}` }
    case "install_plans":
      return { kind: "href", href: `/install?id=${entityId}` }
    case "cp_systems":
      return { kind: "href", href: `/cp-system?id=${entityId}` }
    case "products":
      return { kind: "href", href: `/inventory?id=${entityId}` }
    case "stock_movements":
      return { kind: "href", href: `/inventory/in-and-out?id=${entityId}` }
    case "profiles":
      return { kind: "href", href: `/users?id=${entityId}` }
    case "company_settings":
    case "daily_report_sections":
      return { kind: "href", href: "/settings" }
    case "announcements":
      return { kind: "href", href: "/" }
    case "schedule_job_filter_items": {
      const scheduleJobId = (entry.newValues.schedule_job_id ?? entry.oldValues.schedule_job_id) as
        | string
        | undefined
      if (!scheduleJobId) {
        return { kind: "unavailable", message: "Can't trace this filter item back to its schedule job from this entry." }
      }
      return { kind: "href", href: `/schedule?id=${scheduleJobId}` }
    }
    case "suppliers":
      return {
        kind: "unavailable",
        message: "Suppliers don't have their own page — manage them from Inventory when adding or editing a product.",
      }
    case "sales":
      return { kind: "unavailable", message: "This record type doesn't have a page in the app." }
    default:
      return undefined
  }
}
