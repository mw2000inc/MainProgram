import type { GridPickerOption } from "@/components/shared/inline-edit-cell"
import type { CpSystem, Product } from "@/lib/types"
import { parseItemString } from "@/lib/utils"

// The inventory `products` table is the only catalog of filter parts — the
// technician's job-completion filter picker and the live half of the Sale
// List's Product# dropdown both read it — but it has no "is a filter" flag,
// and its `category` holds the brand ("MW", "SK") rather than the
// Purifiers/Filters/Accessories taxonomy in PRODUCT_CATEGORIES. So filter parts
// are every product that isn't in one of the categories that are explicitly
// something else (today that only excludes the "9001 ETC" Purifiers
// placeholder; a future "Filters"-category or new-brand product is included
// automatically).
const NON_FILTER_PRODUCT_CATEGORIES = new Set(["Purifiers", "Accessories"])

// Product names usually follow "[SKU] / [Description]" (e.g. "012 / MW) Pre-
// Carbon") but that's not enforced — strip the redundant SKU prefix from the
// tile label only when it's actually there.
function shortLabel(product: Product): string {
  const prefix = `${product.sku} / `
  return product.name.startsWith(prefix) ? product.name.slice(prefix.length) : product.name
}

// value is the product's SKU (e.g. "012") — the same short code already typed
// by hand into filter_change_plans.filter_type.
export function getFilterPartOptions(products: Product[]): GridPickerOption[] {
  return products
    .filter((p) => !!p.sku && !NON_FILTER_PRODUCT_CATEGORIES.has(p.category))
    .map((p) => ({ value: p.sku, label: shortLabel(p), group: p.category }))
    .sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
}

// A CP System's own components carry a filter's identity only as a loose
// text convention, the same "[SKU] / [Description]" pattern parseItemString
// already splits for the Product form and the Add Part dialog (e.g. "012 /
// MW) Pre-Carbon" -> "012") — never a real product_id, see CpSystemComponent's
// own comment. A bare code with no slash (e.g. "014") is used as-is. Checked
// against the live catalog before relying on this: 152 of 166 components
// across every cataloged system resolve to a real product SKU this way; the
// rest (AW/PF/PR-series systems) name parts that were never in this app's
// product catalog to begin with, not a parsing failure — silently skipped
// rather than surfacing a raw, non-existent "SKU" no admin could act on.
// Deduplicated since two components can legitimately reference the same
// physical part at two different intervals.
export function getCpSystemFilterSkus(system: CpSystem, products: Product[]): string[] {
  const validSkus = new Set(products.map((p) => p.sku))
  const skus: string[] = []
  for (const component of system.components) {
    const code = (parseItemString(component.name)?.sku ?? component.name).trim()
    if (validSkus.has(code) && !skus.includes(code)) skus.push(code)
  }
  return skus
}

// The filters a CP System has due on a visit date: whole months since the
// order's CP Start, and every component whose interval divides it — the same
// rule the database uses for generated visits (cp_system_due_filters,
// 20261008000000). Codes are the part before " / ", each listed once.
// Empty when nothing is due that month, or the date is on/before CP Start.
export function cpSystemDueFilterCodes(system: CpSystem, cpStart: string | undefined, visitDate: string | undefined): string[] {
  if (!cpStart || !visitDate || visitDate <= cpStart) return []
  const [sy, sm, sd] = cpStart.split("-").map(Number)
  const [vy, vm, vd] = visitDate.split("-").map(Number)
  const elapsed = (vy - sy) * 12 + (vm - sm) - (vd < sd ? 1 : 0)
  if (elapsed <= 0) return []
  const due = new Map<string, number>()
  for (const c of system.components) {
    if (!c.intervalMonths || elapsed % c.intervalMonths !== 0) continue
    const code = c.name.split(" / ")[0].trim()
    if (code && (!due.has(code) || c.intervalMonths < due.get(code)!)) due.set(code, c.intervalMonths)
  }
  return [...due].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([code]) => code)
}
