import type { ScheduleJob } from "@/lib/types"

// A job whose date has passed and that isn't completed or cancelled —
// unfinished work from an earlier day. One rule for the Full Schedule's
// "Overdue" filter and the Daily Report's "N unfinished from earlier days"
// link, so the count and the list always agree. `today` is the business
// day in Manila (businessToday()).
export function isOverdueJob(job: Pick<ScheduleJob, "scheduledDate" | "status">, today: string): boolean {
  return job.scheduledDate < today && job.status !== "completed" && job.status !== "cancelled"
}

// The Full Schedule with the Overdue filter on.
export const OVERDUE_SCHEDULE_HREF = "/schedule?filter=overdue"
