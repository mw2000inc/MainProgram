import type { CpSystem, CpSystemComponent, Product } from "@/lib/types"
import { parseItemString } from "@/lib/utils"

// A system's family is its code minus the trailing digit — "UF71" -> "UF7",
// "RO41" -> "RO4", "PF11" -> "PF1". A code that doesn't end in a digit
// (UF4OSS, PFS4ON, "PR 2 Stage / 6mos") has nothing to strip and is its own
// family. Derived from the code at render time, never stored, so a system
// added later lands under the right header without anyone maintaining a list.
export function cpSystemFamily(code: string): string {
  const trimmed = code.trim()
  return /\d$/.test(trimmed) ? trimmed.slice(0, -1) : trimmed
}

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

// The list's display order: families descending (UF7, UF5, UF4, then RO7,
// RO5, RO4, ...), and by code ascending within each family. The grouped
// table renders rows in exactly this order, so it is also what Prev/Next in
// the detail panel must step through.
export function sortCpSystemsForList(systems: CpSystem[]): CpSystem[] {
  return [...systems].sort((a, b) => {
    const byFamily = naturalCompare(cpSystemFamily(b.systemCode), cpSystemFamily(a.systemCode))
    return byFamily !== 0 ? byFamily : naturalCompare(a.systemCode, b.systemCode)
  })
}

// sku -> readable filter description ("014" -> "MW) RO filter"), from the
// live product catalog. Product names are usually "[SKU] / [Description]" and
// only that prefix is dropped; a name without one is used whole.
export function buildFilterDescriptionMap(products: Product[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of products) {
    const sku = p.sku.trim()
    if (sku && !map.has(sku)) map.set(sku, parseItemString(p.name)?.description ?? p.name.trim())
  }
  return map
}

// A component's stored name is either "NNN / description" (the description is
// used, the code dropped), or a bare code like "014" (looked up in the product
// catalog), or a bare code the catalog doesn't know (401, 1152, 9002, ... —
// shown as the code itself, since there is nothing readable to show instead).
export function describeCpComponentName(name: string, descriptionBySku: Map<string, string>): string {
  const parsed = parseItemString(name)
  if (parsed) return parsed.description
  const code = name.trim()
  return descriptionBySku.get(code) ?? code
}

// "MW) Sediment - 3M, MW) Pre-Carbon - 6M, ..." — shortest interval first
// (stable, so components sharing an interval keep the order they were entered
// in). "x{quantity}" only when it isn't the implied default of 1, which also
// covers every component predating the quantity field.
export function formatCpSystemComponents(
  components: CpSystemComponent[],
  descriptionBySku: Map<string, string>
): string {
  return [...components]
    .sort((a, b) => a.intervalMonths - b.intervalMonths)
    .map(
      (c) =>
        `${describeCpComponentName(c.name, descriptionBySku)}${c.quantity && c.quantity !== 1 ? ` x${c.quantity}` : ""} - ${c.intervalMonths}M`
    )
    .join(", ")
}
