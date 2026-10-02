import { addMonths, differenceInCalendarDays, format, parseISO, subDays } from "date-fns"

// The filter-change automation only schedules a visit for an order's CURRENT
// cycle, and only while it's recently due. Before, it compared today with
// the FIRST due date after installation (anchor + one interval) — for a unit
// installed in 2019 that date is forever in the past, so the automation
// treated every old order as overdue on every run and flooded the Schedule
// with 2019–2025 "due" jobs.

// A cycle that came due more than this many days ago is left alone: it's a
// backlog for an admin to review, not something to drop onto today's
// schedule automatically.
export const AUTO_FILTER_CHANGE_MAX_OVERDUE_DAYS = 7

// A Filter Change visit completed (Acc D) up to this many days BEFORE the
// cycle's due date still counts as that cycle's visit — technicians often
// change filters a little early.
export const AUTO_FILTER_CHANGE_EARLY_DONE_DAYS = 30

// The most recent milestone (anchor + interval × k, k ≥ 1) on or before
// `today`, as yyyy-MM-dd — or null while the first one hasn't come yet.
export function currentFilterChangeDue(anchor: string, intervalMonths: number, today: string): string | null {
  if (!anchor || !(intervalMonths > 0)) return null
  const start = parseISO(anchor)
  const now = parseISO(today)
  const monthsElapsed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  let k = Math.floor(monthsElapsed / intervalMonths)
  while (k >= 1 && addMonths(start, intervalMonths * k) > now) k--
  if (k < 1) return null
  return format(addMonths(start, intervalMonths * k), "yyyy-MM-dd")
}

export type AutoFilterChangeDecision =
  | { due: string }
  | { skip: "notYetDue" | "tooOld" | "doneThisCycle"; due?: string }

// Whether the automation should create a job for this order today, and for
// which due date. `lastDone` is the latest Acc D of the order's completed
// Filter Change visits, if any.
export function autoFilterChangeDecision(
  anchor: string,
  intervalMonths: number,
  today: string,
  lastDone?: string
): AutoFilterChangeDecision {
  const due = currentFilterChangeDue(anchor, intervalMonths, today)
  if (!due) return { skip: "notYetDue" }
  if (differenceInCalendarDays(parseISO(today), parseISO(due)) > AUTO_FILTER_CHANGE_MAX_OVERDUE_DAYS) return { skip: "tooOld", due }
  if (lastDone && lastDone >= format(subDays(parseISO(due), AUTO_FILTER_CHANGE_EARLY_DONE_DAYS), "yyyy-MM-dd")) {
    return { skip: "doneThisCycle", due }
  }
  return { due }
}
