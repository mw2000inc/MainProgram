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

// Automatic scheduling runs Monday to Friday. The draft generator (the
// daily run and the Daily Report's Generate Drafts) never dates a job on a
// Saturday or Sunday: a visit due on a weekend goes on the following Monday,
// and one already past due goes on today, or the following Monday when today
// is a weekend. Friday visits stay on Friday. Dates are Manila calendar days
// (yyyy-MM-dd). Saturday work is still scheduled by hand (Schedule Job,
// Assign Saturday Coverage).
const SATURDAY = 6
const SUNDAY = 0

export function isWeekend(day: string): boolean {
  const d = parseISO(day).getDay()
  return d === SATURDAY || d === SUNDAY
}

// The day itself on Monday–Friday, otherwise the following Monday.
export function nextWorkingDay(day: string): string {
  const d = parseISO(day)
  const add = d.getDay() === SATURDAY ? 2 : d.getDay() === SUNDAY ? 1 : 0
  return add ? format(addDays(d, add), "yyyy-MM-dd") : day
}

// The date an automatically drafted job goes on, for a visit due on
// `visitDate` when the business day is `today`.
export function autoJobDate(visitDate: string, today: string): string {
  return nextWorkingDay(visitDate < today ? today : visitDate)
}

// Saturday coverage is confirmed by an admin: a job dispatched for a Saturday
// starts as 'pending_approval' (hidden from technicians until approved).
export function isSaturday(day: string): boolean {
  return parseISO(day).getDay() === SATURDAY
}

export function requiresSaturdayApproval(day: string): boolean {
  return isSaturday(day)
}

// Where a cancelled Saturday's queue is spread: the Monday, Tuesday and
// Wednesday after it.
export function businessDaysAfterSaturday(saturday: string): string[] {
  const d = parseISO(saturday)
  return [2, 3, 4].map((n) => format(addDays(d, n), "yyyy-MM-dd"))
}

// The Saturdays inside a timeframe.
export function saturdaysInRange(range: { start: string; end: string }): string[] {
  const out: string[] = []
  const end = parseISO(range.end)
  for (let d = parseISO(range.start), n = 0; d <= end && n < 62; d = addDays(d, 1), n++) {
    if (d.getDay() === SATURDAY) out.push(format(d, "yyyy-MM-dd"))
  }
  return out
}
