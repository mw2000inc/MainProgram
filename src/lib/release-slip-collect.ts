import { formatCurrency } from "@/lib/utils"
import type { CollectionPlan, SaleListEntry } from "@/lib/types"
import type { ReleaseSlipJob } from "@/lib/api/release-slip"

// The money a technician collects on a slip job, for its Notes column:
// "To Collect: ₱8,500.00 (Cash) · note" — "Collected:" once it's collected.
//
// - A Collection job: its own Collection record (linked by job); with no
//   record, the order's C/F (the full C/F every visit — the Schedule
//   printout's rule; the Sale List is admin-only, so a technician's slip
//   shows nothing then).
// - A Filter Change / Installation / Repair job: the open Collection on the
//   same order for that visit day (Pre D, else Plan D) that has no schedule
//   job of its own, so money taken on the same trip isn't missed — unless the
//   same technician's slip already has a Collection job for that order,
//   which shows it.
// Nothing for a cancelled Collection or a zero amount.
type SlipJobRef = Pick<ReleaseSlipJob, "jobId" | "orderNo" | "jobType" | "technician" | "technician2">

export function collectionNoteFor(
  job: SlipJobRef,
  // slipJobs: every job loaded for the slip (all technicians' in "All
  // technicians" mode) — only those sharing a technician with this job count.
  context: { date: string; collections: CollectionPlan[]; saleListEntries: SaleListEntry[]; slipJobs: SlipJobRef[] }
): string | undefined {
  const order = (job.orderNo ?? "").trim()
  const crew = [job.technician, job.technician2].map((t) => (t ?? "").trim().toLowerCase()).filter(Boolean)
  const sameSlip = context.slipJobs.filter((s) => [s.technician, s.technician2].some((t) => crew.includes((t ?? "").trim().toLowerCase())))
  let record: CollectionPlan | undefined
  if (job.jobType === "collection") {
    record = context.collections.find((c) => c.scheduleJobId === job.jobId)
    if (!record) {
      const cf = context.saleListEntries.find((e) => e.orderNumber.trim() === order)?.cf
      const amount = Number(String(cf ?? "").replace(/[^0-9.]/g, ""))
      return amount > 0 ? `To Collect: ${formatCurrency(amount)}` : undefined
    }
  } else if (["filter_change", "installation", "repair"].includes(job.jobType) && order) {
    if (sameSlip.some((s) => s.jobType === "collection" && (s.orderNo ?? "").trim() === order)) return undefined
    // A collection with its own schedule job shows through that job only —
    // when it's on the slip — never here: one set back to Pending (not
    // collected) has its job out of the slip, so it doesn't reappear as
    // "To Collect" on the visit's row.
    // Nor a job-less copy (a recurring placeholder) of a collection that is
    // scheduled for that order and day.
    const sameDay = context.collections.filter(
      (c) => c.orderNo.trim() === order && (c.preD || c.collectionDate) === context.date && c.status !== "Cancelled"
    )
    record = sameDay.some((c) => c.scheduleJobId) ? undefined : sameDay[0]
  }
  if (!record || record.status === "Cancelled" || !(Number(record.amount) > 0)) return undefined
  // Set back to Pending = not collected, whatever the old collected mark says.
  const label = record.status === "Collected" || (record.collected && record.status !== "Pending") ? "Collected" : "To Collect"
  const payment = record.paymentType?.trim() ? ` (${record.paymentType.trim()})` : ""
  const note = record.note?.trim() ? ` · ${record.note.trim()}` : ""
  return `${label}: ${formatCurrency(Number(record.amount))}${payment}${note}`
}
