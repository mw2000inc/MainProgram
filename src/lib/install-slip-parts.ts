import type { InstallPlan } from "@/lib/types"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"

// Parts added for an installation on the Release Slip — shown as its "Part
// No" (Daily Report Installation panel, install detail), like a repair's.
// They're the movements the slip saved onto the install's job (they carry
// its schedule job link). The install's own unit (queued from its Model with
// only the record link, or its Model code typed on the slip) isn't a part.
// Rejected ones are left out.
export type InstallSlipPart = { sku: string; out: number; in: number; pending: boolean }

export function installSlipParts(
  plan: Pick<InstallPlan, "id" | "scheduleJobId" | "model">,
  movements: Pick<StockMovementRow, "scheduleJobId" | "installPlanId" | "status" | "productId" | "sku" | "itemLabel" | "productName" | "quantityAdded" | "quantityRemoved" | "changeRequest" | "reason">[]
): InstallSlipPart[] {
  const parts: InstallSlipPart[] = []
  const unitSku = (plan.model ?? "").split(" / ")[0].trim()
  for (const m of movements) {
    if (m.status === "rejected" || !m.scheduleJobId) continue
    if (m.scheduleJobId !== plan.scheduleJobId && m.installPlanId !== plan.id) continue
    const sku = ((m.productId ? m.sku : m.itemLabel) || m.productName || "").trim()
    if (!sku || sku === unitSku) continue
    let p = parts.find((x) => x.sku === sku)
    if (!p) {
      p = { sku, out: 0, in: 0, pending: false }
      parts.push(p)
    }
    p.out += m.quantityRemoved || 0
    p.in += m.quantityAdded || 0
    if (m.status === "pending" || m.changeRequest) p.pending = true
  }
  return parts
}

// "1152 ×2, 013" — for a plain-text field.
export function installSlipPartsText(parts: InstallSlipPart[]): string {
  return parts
    .flatMap((p) => [
      ...(p.out ? [`${p.sku}${p.out !== 1 ? ` ×${p.out}` : ""}`] : []),
      ...(p.in ? [`${p.sku}${p.in !== 1 ? ` ×${p.in}` : ""} (IN)`] : []),
    ])
    .join(", ")
}
