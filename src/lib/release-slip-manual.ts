import type { ReleaseSlipJob } from "@/lib/api/release-slip"
import { MANUAL_JOB_TYPE } from "@/components/release-slip/release-slip-sheets"

// Extra parts and errand notes added by hand to a day's Release Slip. They
// are kept in this browser only (per date and technician) — nothing is
// written to the database and no stock is moved; the slip is a paper record.

export type ManualSlipCategory = "part" | "errand"

export interface ManualSlipItem {
  id: string
  category: ManualSlipCategory
  item: string
  direction: "out" | "in"
  qty: number
  note: string
}

const storageKey = (date: string, technicianId: string) => `release-slip-manual:${date}:${technicianId}`

export function loadManualItems(date: string, technicianId: string): ManualSlipItem[] {
  try {
    const raw = window.localStorage.getItem(storageKey(date, technicianId))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveManualItems(date: string, technicianId: string, items: ManualSlipItem[]) {
  try {
    if (items.length) window.localStorage.setItem(storageKey(date, technicianId), JSON.stringify(items))
    else window.localStorage.removeItem(storageKey(date, technicianId))
  } catch {
    // Storage blocked (private window): the rows still show until the page is left.
  }
}

// The manual rows as one extra block at the end of the slip.
export function manualSlipJob(items: ManualSlipItem[]): ReleaseSlipJob | null {
  if (!items.length) return null
  return {
    jobId: "manual",
    orderNo: "MANUAL",
    accountName: "Manual / Errand Items",
    jobType: MANUAL_JOB_TYPE,
    status: "completed",
    technician: "",
    technician2: "",
    movements: items.map((i) => {
      const hasItem = i.item.trim() !== ""
      const label = i.item.trim()
      return {
        sku: label,
        label,
        qtyOut: hasItem && i.direction === "out" ? i.qty : 0,
        qtyIn: hasItem && i.direction === "in" ? i.qty : 0,
        status: "manual",
        note: i.category === "errand" ? `TASK: ${i.note.trim()}` : i.note.trim(),
        errand: i.category === "errand",
      }
    }),
  }
}
