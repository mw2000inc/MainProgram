import { todayIso } from "@/lib/utils"

// The completion date (Filter Change / Repair Acc D, Install Installed Date)
// to send with a change made from a job's Status dropdown:
//   - marked Completed with no date yet -> today's local date (a date already
//     entered is never overwritten; it stays editable afterwards)
//   - taken from Completed back to Pending / Cancelled -> "" (cleared), which
//     also retracts the job's still-pending Inventory Approvals entries — the
//     database's queue triggers react to the cleared date
//   - anything else -> undefined (leave the date alone)
// Sent in the same update as the status, so those triggers see both at once.
export function completionDateFor(
  status: string,
  previousStatus: string,
  currentDate: string | undefined
): string | undefined {
  if (status === "Completed") return currentDate ? undefined : todayIso()
  if (previousStatus === "Completed" && currentDate) return ""
  return undefined
}
