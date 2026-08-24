import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns"
import type { ContractStatus, MonitoringViewStatus, StockStatus } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const EXPIRY_WINDOW_DAYS = 30

export function getContractStatus(endDate: string, today: Date = new Date()): ContractStatus {
  const days = differenceInCalendarDays(parseISO(endDate), today)
  if (days < 0) return "expired"
  if (days <= EXPIRY_WINDOW_DAYS) return "expiring"
  return "active"
}

export function daysUntil(date: string, today: Date = new Date()): number {
  return differenceInCalendarDays(parseISO(date), today)
}

// Rolls a date forward in 3-month increments so it always reflects the next quarterly checkpoint.
// Compares by calendar day (not exact timestamp) so "today" itself counts as reached, not before.
export function getNextQuarterlyDate(anchorDate: string, today: Date = new Date()): Date {
  let next = parseISO(anchorDate)
  while (differenceInCalendarDays(next, today) < 0) {
    next = addMonths(next, 3)
  }
  return next
}

// The monitoring interval (in months) for a given Water Purification Type — a
// per-type override from Settings, falling back to the configured default (6).
// Accepts a loose settings shape so both CompanySettings and the portal's
// settings payload work.
export const DEFAULT_MONITORING_MONTHS = 6

export function getMonitoringIntervalMonths(
  dispenserType: string,
  settings?: { monitoringDefaultMonths?: number; monitoringIntervals?: Record<string, number> } | null
): number {
  const fallback = settings?.monitoringDefaultMonths ?? DEFAULT_MONITORING_MONTHS
  const mapped = settings?.monitoringIntervals?.[dispenserType]
  return typeof mapped === "number" && mapped > 0 ? mapped : fallback
}

// Next monitoring/replacement due date = anchor + interval, where anchor is the
// installed date when on file, otherwise the contract start.
export function getMonitoringEndDate(anchorDate: string, intervalMonths: number): Date {
  return addMonths(parseISO(anchorDate), intervalMonths)
}

// Same due-date concept as getMonitoringEndDate above, bundled for callers that
// only have the customer + settings on hand (e.g. the filter-change auto-
// schedule cron) rather than a pre-picked anchor/interval.
export function getCustomerFilterChangeDueDate(
  customer: { installedDate?: string; contractStart: string; dispenserType: string },
  settings?: { monitoringDefaultMonths?: number; monitoringIntervals?: Record<string, number> } | null
): Date {
  const anchor = customer.installedDate ?? customer.contractStart
  const months = getMonitoringIntervalMonths(customer.dispenserType, settings)
  return getMonitoringEndDate(anchor, months)
}

// Three-bucket customer-facing status derived from the monitoring End Date:
// past due -> for replacement, within the expiry window -> expiring, else active.
export function getMonitoringStatus(endDate: Date | string, today: Date = new Date()): MonitoringViewStatus {
  const end = typeof endDate === "string" ? parseISO(endDate) : endDate
  const days = differenceInCalendarDays(end, today)
  if (days < 0) return "for-replacement"
  if (days <= EXPIRY_WINDOW_DAYS) return "expiring"
  return "active"
}

export function getStockStatus(quantity: number, minLevel: number): StockStatus {
  if (quantity <= 0) return "out-of-stock"
  if (quantity <= minLevel) return "low-stock"
  return "in-stock"
}

export function formatCurrency(value: number, currency = "PHP"): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value)
}

export function formatDate(date: string | Date, pattern = "MMM d, yyyy"): string {
  const d = typeof date === "string" ? parseISO(date) : date
  return format(d, pattern)
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === "string" ? parseISO(date) : date
  return format(d, "MMM d, yyyy h:mm a")
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("")
}

export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

const ORDER_NUMBER_PREFIX = "SK001"

export function formatOrderNumber(sequence: number): string {
  return `${ORDER_NUMBER_PREFIX}-${String(sequence).padStart(4, "0")}`
}

// Reads the numeric sequence back out of a "SK001-0001" style order number.
export function parseOrderNumberSequence(orderNumber: string): number {
  const match = orderNumber.match(/(\d+)$/)
  return match ? parseInt(match[1], 10) : 0
}
