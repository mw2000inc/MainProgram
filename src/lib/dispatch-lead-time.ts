import { addDays, format, parseISO } from "date-fns"

// Customer confirmation emails go out at least this many days before the
// visit (Step 1 of the dispatch pipeline: the email is sent when an admin
// approves a Draft). Shared by /api/dispatch/approve (which refuses a late
// send unless the admin chooses to move the date or send anyway) and the
// approval queues (which show each Draft's "send by" date).
export const CONFIRMATION_LEAD_DAYS = 2

// Today in the business's own timezone (the server runs in UTC).
export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

// The last day the confirmation email can go out with full notice.
export function confirmationSendByDate(visitDate: string): string {
  return format(addDays(parseISO(visitDate), -CONFIRMATION_LEAD_DAYS), "yyyy-MM-dd")
}

// A visit closer than the lead time — its confirmation email would be late.
export function isShortNotice(visitDate: string, today = businessToday()): boolean {
  return visitDate < format(addDays(parseISO(today), CONFIRMATION_LEAD_DAYS), "yyyy-MM-dd")
}

// The earliest visit date that still gives full notice from today; a
// Sunday (no field work) rolls to Monday.
export function earliestFullNoticeDate(today = businessToday()): string {
  let day = addDays(parseISO(today), CONFIRMATION_LEAD_DAYS)
  if (day.getDay() === 0) day = addDays(day, 1)
  return format(day, "yyyy-MM-dd")
}
