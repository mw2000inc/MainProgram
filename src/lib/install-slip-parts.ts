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

type PartsMovement = Parameters<typeof installSlipParts>[1][number] & { filterChangePlanId?: string; repairPlanId?: string; repairPlanPartId?: string; relatedScheduleJobId?: string }

function addPart(parts: InstallSlipPart[], m: PartsMovement) {
  const sku = ((m.productId ? m.sku : m.itemLabel) || m.productName || "").trim()
  if (!sku) return
  let p = parts.find((x) => x.sku === sku)
  if (!p) {
    p = { sku, out: 0, in: 0, pending: false }
    parts.push(p)
  }
  p.out += m.quantityRemoved || 0
  p.in += m.quantityAdded || 0
  if (m.status === "pending" || m.changeRequest) p.pending = true
}

// A Filter Change visit's parts (Daily Report Filter Change "Part No"): the
// items queued for it — on its form or added on the Release Slip — and the
// ones saved onto its job that belong to no other record. Rejected ones are
// left out.
export function filterChangeSlipParts(plan: { id: string; scheduleJobId?: string }, movements: PartsMovement[]): InstallSlipPart[] {
  const parts: InstallSlipPart[] = []
  for (const m of movements) {
    if (m.status === "rejected") continue
    const onJob = !!plan.scheduleJobId && m.scheduleJobId === plan.scheduleJobId && !m.filterChangePlanId && !m.installPlanId && !m.repairPlanId && !m.repairPlanPartId
    if (m.filterChangePlanId === plan.id || onJob) addPart(parts, m)
  }
  return parts
}

// A Collection's parts: items saved onto its visit's job (Release Slip) that
// belong to no Filter Change / install / repair record.
export function collectionSlipParts(plan: { scheduleJobId?: string }, movements: PartsMovement[]): InstallSlipPart[] {
  const parts: InstallSlipPart[] = []
  if (!plan.scheduleJobId) return parts
  for (const m of movements) {
    if (m.status === "rejected" || m.filterChangePlanId || m.installPlanId || m.repairPlanId || m.repairPlanPartId) continue
    if ((m.scheduleJobId || m.relatedScheduleJobId) === plan.scheduleJobId) addPart(parts, m)
  }
  return parts
}
