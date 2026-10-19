// The completion date (Filter Change / Repair / Collection Acc D, Install
// Installed Date) to send with a change made from a Status dropdown:
//   - marked Completed (from not completed) -> `day`: the day of the event —
//     the Daily Report date being viewed, or the record's own Pre D on a full
//     page — never the calendar day the button was clicked. With no `day`,
//     nothing is sent and the database fills Pre D / the job's date
//     (completion_date_from_pre_d, 20261116000000).
//   - taken from Completed back to Pending / Cancelled -> "" (cleared), which
//     also retracts the job's still-pending Inventory Approvals entries — the
//     database's queue triggers react to the cleared date
//   - anything else -> undefined (leave the date alone)
// Sent in the same update as the status, so those triggers see both at once.
export function completionDateFor(
  status: string,
  previousStatus: string,
  currentDate: string | undefined,
  day?: string
): string | undefined {
  const done = (s: string) => s === "Completed" || s === "Collected"
  if (done(status)) return done(previousStatus) ? undefined : day || undefined
  if (done(previousStatus) && currentDate) return ""
  return undefined
}
