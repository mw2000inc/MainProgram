import { CalendarClock, Megaphone, HardHat, Droplets, Banknote, Wrench, type LucideIcon } from "lucide-react"
import type { DailyReportSectionConfig, DailyReportSectionKey } from "@/lib/types"

// Every valid section key, in the app's original (pre-configuration)
// order — used wherever all six need to be listed regardless of what's
// currently enabled/reordered (e.g. the admin settings panel, or filling in
// a section daily_report_sections doesn't have a row for yet).
export const ALL_DAILY_REPORT_SECTION_KEYS: DailyReportSectionKey[] = [
  "schedule",
  "announcements",
  "installation",
  "filter_change",
  "collection",
  "repair",
]

export const DEFAULT_SECTION_LABELS: Record<DailyReportSectionKey, string> = {
  schedule: "Schedule",
  announcements: "Announcement",
  installation: "Installation",
  filter_change: "Filter Change",
  collection: "Collection",
  repair: "Repair",
}

export const SECTION_ICONS: Record<DailyReportSectionKey, LucideIcon> = {
  schedule: CalendarClock,
  announcements: Megaphone,
  installation: HardHat,
  filter_change: Droplets,
  collection: Banknote,
  repair: Wrench,
}

// The fields an admin can show/hide per section, in the same order they're
// offered in the "Visible Fields" checklist — sourced from each section's
// existing column definitions (see the matching *-columns.tsx). Omitted
// entirely for "schedule"/"announcements": neither is a column-table panel,
// so field visibility doesn't apply to them. These labels stay in English
// regardless of interface language for now — an admin-only settings
// checklist, same deferred-to-long-tail treatment as the export column
// header arrays (JOB_TYPE_LABELS, SALE_LIST_EXPORT_COLUMNS, etc.); the
// `key` strings here don't map cleanly 1:1 onto fields.json's own key
// names, so revisit as its own pass rather than guessing a mapping.
export const SECTION_FIELDS: Partial<Record<DailyReportSectionKey, { key: string; label: string }[]>> = {
  installation: [
    { key: "name", label: "Name" },
    { key: "orderNo", label: "Order No" },
    { key: "address", label: "Address" },
    { key: "contactNumber", label: "Contact #" },
    { key: "inOut", label: "In or Out" },
    { key: "model", label: "Model" },
    { key: "unitPrice", label: "Unit Price" },
    { key: "cpPrice", label: "C/P Price" },
    { key: "preInstalledDate", label: "Pre Installed Date" },
    { key: "installedDate", label: "Installed Date" },
    { key: "note", label: "Note" },
    { key: "status", label: "Status" },
  ],
  filter_change: [
    { key: "orderNumber", label: "Order Number" },
    { key: "memberAccount", label: "Member Account#" },
    { key: "filterType", label: "Filter" },
    { key: "status", label: "Status" },
    { key: "contactNumber", label: "Contact #" },
    { key: "address", label: "Address" },
    { key: "sc", label: "S/C" },
    { key: "productNo", label: "Product #" },
    { key: "preD", label: "Pre D" },
    { key: "accD", label: "Acc D" },
    { key: "serviceman", label: "Serviceman" },
    { key: "note", label: "Note" },
  ],
  collection: [
    { key: "orderNo", label: "Order Number" },
    { key: "accountName", label: "Member Account#" },
    { key: "amount", label: "Amount" },
    { key: "ct", label: "C/T" },
    { key: "collectionDate", label: "Plan D" },
    { key: "preD", label: "Pre D" },
    { key: "accD", label: "Acc D" },
    { key: "note", label: "Note" },
  ],
  repair: [
    { key: "accountName", label: "Account Name" },
    { key: "orderNo", label: "Order No" },
    { key: "unitInOut", label: "Unit IN/OUT" },
    { key: "problem", label: "Problem" },
    { key: "solutionStatus", label: "Solution / Status" },
    { key: "preD", label: "Pre D" },
    { key: "accD", label: "Acc D" },
    { key: "amt", label: "AMT" },
    { key: "th", label: "TH" },
    { key: "status", label: "Status" },
  ],
}

// Fills in any section daily_report_sections doesn't have a row for yet
// (e.g. a freshly-added key before its migration has run everywhere) with a
// sensible default, so callers never have to special-case a missing entry.
// Returns all six, sorted by displayOrder — callers filter to `.enabled`
// themselves, since the admin settings panel needs to see disabled ones too.
export function resolveSectionConfigs(rows: DailyReportSectionConfig[]): DailyReportSectionConfig[] {
  const byKey = new Map(rows.map((r) => [r.sectionKey, r]))
  const resolved = ALL_DAILY_REPORT_SECTION_KEYS.map(
    (key, i): DailyReportSectionConfig =>
      byKey.get(key) ?? {
        sectionKey: key,
        label: DEFAULT_SECTION_LABELS[key],
        enabled: true,
        displayOrder: i + 1,
        visibleFields: [],
      }
  )
  return resolved.sort((a, b) => a.displayOrder - b.displayOrder)
}
