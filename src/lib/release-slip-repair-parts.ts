import type { InstallPlan, RepairPlan, SaleListEntry } from "@/lib/types"
import type { ReleaseSlipJob, ReleaseSlipMovement } from "@/lib/api/release-slip"

// A Repair job's lines on the Release Slip from its record's Part No, when
// the database has no stock movements for it (its parts were typed in Part No
// — "013,014,012" — rather than added as repair parts, so nothing was queued
// in Inventory). One line per part code, quantity 1 per mention ("013,013" =
// 2), always under OUT: parts used on a repair leave stock. Unit IN/OUT is
// where the customer's machine is (brought in or not), not a stock direction,
// so it's ignored here. Shown as recorded, not as awaiting approval (no "*").
// A job that already has movements keeps them as they are.
export function repairPartLines(job: Pick<ReleaseSlipJob, "jobId" | "jobType" | "movements">, repairPlans: RepairPlan[]): ReleaseSlipMovement[] | undefined {
  if (job.jobType !== "repair" || job.movements.length > 0) return undefined
  const record = repairPlans.find((r) => r.scheduleJobId === job.jobId && (r.partNo ?? "").trim())
  if (!record) return undefined
  const counts = new Map<string, number>()
  for (const raw of (record.partNo ?? "").split(/[,;/\n]+/)) {
    const code = raw.trim()
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  if (counts.size === 0) return undefined
  return [...counts].map(([sku, qty]) => ({ sku, label: sku, qtyOut: qty, qtyIn: 0, status: "recorded" }))
}

// An Installation job's line on the Release Slip when it has no stock
// movement yet: its unit, OUT 1 — the installation's Model, else the order's
// Product # on the Sale List. The SKU is the code before " / " ("106 /
// MW) Oasis-S2 (Black)" → 106), which is how Inventory numbers its products.
// Shown as recorded (no "*"); saving the slip queues it in Inventory.
export function installUnitLines(
  job: Pick<ReleaseSlipJob, "jobId" | "jobType" | "orderNo" | "movements">,
  installPlans: Pick<InstallPlan, "scheduleJobId" | "model">[],
  saleListEntries: Pick<SaleListEntry, "orderNumber" | "productNo">[]
): ReleaseSlipMovement[] | undefined {
  if (job.jobType !== "installation" || job.movements.length > 0) return undefined
  const order = (job.orderNo ?? "").trim()
  const unit =
    (installPlans.find((p) => p.scheduleJobId === job.jobId)?.model ?? "").trim() ||
    (order ? (saleListEntries.find((e) => e.orderNumber.trim() === order)?.productNo ?? "").trim() : "")
  const sku = unit.split(" / ")[0].trim()
  if (!sku) return undefined
  return [{ sku, label: unit, qtyOut: 1, qtyIn: 0, status: "recorded" }]
}

// A Repair job's unit on the Release Slip, as on the Daily Report (UNIT OUT /
// UNIT IN): the repair's Model code, 1, under OUT or IN as its Unit IN/OUT
// says, with "UNIT OUT" / "UNIT IN" in Notes. Shown for the record only —
// Unit IN/OUT is where the customer's machine is, not stock — so it's never
// saved as a part (unitLine). Left out when the job already lists that code
// on that side (a part with the same code, say).
export function repairUnitLines(job: Pick<ReleaseSlipJob, "jobId" | "jobType" | "movements">, repairPlans: RepairPlan[]): ReleaseSlipMovement[] {
  if (job.jobType !== "repair") return []
  const record = repairPlans.find((r) => r.scheduleJobId === job.jobId)
  const model = (record?.model ?? "").trim()
  const sku = model.split(" / ")[0].trim()
  const side = (record?.unitInOut ?? "").trim().toLowerCase()
  if (!sku || (side !== "in" && side !== "out")) return []
  const listed = job.movements.some((m) => (m.sku || m.label).trim() === sku && (side === "out" ? m.qtyOut > 0 : m.qtyIn > 0))
  if (listed) return []
  return [{ sku, label: model, qtyOut: side === "out" ? 1 : 0, qtyIn: side === "in" ? 1 : 0, status: "recorded", note: side === "out" ? "UNIT OUT" : "UNIT IN", unitLine: sku }]
}
