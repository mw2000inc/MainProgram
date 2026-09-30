import type { CpSystem } from "@/lib/types"

// Client-side mirror of the database's cp_system_due_filters() (see the
// 20261008000000_cp_system_filter_auto_fill migration), for places that need
// a CP System's due filters without a generated Filter Change visit — the
// Schedule page's Auto-suggest modal pre-filling a job's Filters. Same rule:
// a component is due when the months elapsed since the order's anchor are a
// multiple of its interval; codes are the part before " / ", grouped (one
// entry per code), ordered by each code's shortest interval then by code.

const codeOf = (name: string) => name.split(" / ")[0]

export function cpSystemMinInterval(system: CpSystem): number | undefined {
  const intervals = system.components.map((c) => c.intervalMonths).filter((n) => n > 0)
  return intervals.length > 0 ? Math.min(...intervals) : undefined
}

export function cpSystemDueFilters(system: CpSystem, elapsedMonths: number): string {
  const due = new Map<string, number>()
  for (const c of system.components) {
    if (c.intervalMonths > 0 && elapsedMonths % c.intervalMonths === 0) {
      const code = codeOf(c.name)
      due.set(code, Math.min(due.get(code) ?? Infinity, c.intervalMonths))
    }
  }
  return [...due]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([code]) => code)
    .join(", ")
}

function monthsBetween(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.split("-").map(Number)
  const [y2, m2, d2] = toIso.split("-").map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30
}

// The filters due at the milestone nearest to `date`. Visits are generated at
// anchor + shortest interval × k (k ≥ 1), but a schedule job's own date
// rarely lands on one exactly (e.g. an order anchored on the 29th with a job
// on the 15th), so the elapsed months are rounded to the nearest multiple of
// the shortest interval — never below the first one, since day 0 is the
// installation itself. anchorDate is what filter_change_schedule_anchor_date()
// uses: the order's occurrence-0 visit date, else its CP Start.
export function cpSystemDueFiltersForDate(system: CpSystem, anchorDate: string, date: string): string {
  const min = cpSystemMinInterval(system)
  if (!min || !anchorDate || !date) return ""
  const k = Math.max(1, Math.round(monthsBetween(anchorDate, date) / min))
  return cpSystemDueFilters(system, min * k)
}
