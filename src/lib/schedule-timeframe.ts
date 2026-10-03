import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns"

// The Schedule widget's timeframe dropdown. Every range is anchored on the
// Daily Report's selected date (today by default), so picking another day
// in the report moves the whole range with it. Weeks run Monday–Sunday.
export const SCHEDULE_TIMEFRAMES = ["day", "next2", "next3", "next7", "thisWeek", "nextWeek", "thisMonth"] as const
export type ScheduleTimeframe = (typeof SCHEDULE_TIMEFRAMES)[number]

export const SCHEDULE_TIMEFRAME_LABEL: Record<ScheduleTimeframe, string> = {
  day: "timeframeDay",
  next2: "timeframeNext2",
  next3: "timeframeNext3",
  next7: "timeframeNext7",
  thisWeek: "timeframeThisWeek",
  nextWeek: "timeframeNextWeek",
  thisMonth: "timeframeThisMonth",
}

export function isScheduleTimeframe(value: unknown): value is ScheduleTimeframe {
  return typeof value === "string" && (SCHEDULE_TIMEFRAMES as readonly string[]).includes(value)
}

// Inclusive yyyy-MM-dd bounds — compared as strings against scheduledDate.
export function scheduleTimeframeRange(timeframe: ScheduleTimeframe, anchor: string): { start: string; end: string } {
  const day = parseISO(anchor)
  const iso = (d: Date) => format(d, "yyyy-MM-dd")
  switch (timeframe) {
    case "next2":
      return { start: anchor, end: iso(addDays(day, 1)) }
    case "next3":
      return { start: anchor, end: iso(addDays(day, 2)) }
    case "next7":
      return { start: anchor, end: iso(addDays(day, 6)) }
    case "thisWeek":
      return { start: iso(startOfWeek(day, { weekStartsOn: 1 })), end: iso(endOfWeek(day, { weekStartsOn: 1 })) }
    case "nextWeek": {
      const next = addDays(day, 7)
      return { start: iso(startOfWeek(next, { weekStartsOn: 1 })), end: iso(endOfWeek(next, { weekStartsOn: 1 })) }
    }
    case "thisMonth":
      return { start: iso(startOfMonth(day)), end: iso(endOfMonth(day)) }
    default:
      return { start: anchor, end: anchor }
  }
}

// Friday roll-forward. Friday's unfinished work (pending jobs and visits
// with no job yet) carries into Saturday's and Monday's schedule until it's
// done, and anything newly dispatched on a Friday is dated Saturday.
const FRIDAY = 5
const SATURDAY = 6
const MONDAY = 1

// The Friday whose unfinished work shows on `day`: the day before a
// Saturday, three days before a Monday; null on any other day.
export function carriedFridayFor(day: string): string | null {
  const d = parseISO(day)
  if (d.getDay() === SATURDAY) return format(addDays(d, -1), "yyyy-MM-dd")
  if (d.getDay() === MONDAY) return format(addDays(d, -3), "yyyy-MM-dd")
  return null
}

// Fridays carried into a timeframe — only those before it starts (a Friday
// inside the timeframe already shows on its own day).
export function carriedFridaysInRange(range: { start: string; end: string }): string[] {
  const fridays = new Set<string>()
  const end = parseISO(range.end)
  for (let d = parseISO(range.start), n = 0; d <= end && n < 62; d = addDays(d, 1), n++) {
    const friday = carriedFridayFor(format(d, "yyyy-MM-dd"))
    if (friday && friday < range.start) fridays.add(friday)
  }
  return [...fridays]
}

// The date to dispatch something due on `day`: a Friday becomes Saturday.
export function dispatchDateFor(day: string): string {
  const d = parseISO(day)
  return d.getDay() === FRIDAY ? format(addDays(d, 1), "yyyy-MM-dd") : day
}
