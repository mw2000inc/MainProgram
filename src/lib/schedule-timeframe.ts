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
