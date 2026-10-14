import type { ScheduleJob } from "@/lib/types"

// The Schedule panel's jobs for a date range — the one list both the
// Schedule panel (ScheduleAgenda) and the Daily Report's Filter Change /
// Collection / Install / Repair panels read, so the two always agree:
// every job dated in the range, in every status (draft, approved, completed,
// cancelled) — nothing carried in from another day — and, for a technician,
// only their own (schedule_jobs RLS already does this, and hides drafts from
// them; this keeps the view right on its own). Day first, then technician,
// then route order (an unplaced job last).
export function scheduleDayJobs<J extends ScheduleJob>(
  jobs: J[],
  range: { start: string; end: string },
  viewer: { isAdmin: boolean; userId?: string }
): J[] {
  const filtered = jobs.filter(
    (j) =>
      j.scheduledDate >= range.start &&
      j.scheduledDate <= range.end &&
      (viewer.isAdmin || j.technicianUserId === viewer.userId || j.technician2UserId === viewer.userId)
  )
  return [...filtered].sort((a, b) => {
    if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate)
    if (a.technician !== b.technician) return a.technician.localeCompare(b.technician)
    if (a.routeSequence == null && b.routeSequence == null) return 0
    if (a.routeSequence == null) return 1
    if (b.routeSequence == null) return -1
    return a.routeSequence - b.routeSequence
  })
}

// The jobs whose linked records the four panels show for the day: the day's
// jobs above that are drafts, approved or completed — a cancelled job doesn't
// bring its record in.
export function panelLinkJobs<J extends ScheduleJob>(dayJobs: J[]): Map<string, J> {
  return new Map(dayJobs.filter((j) => j.status !== "cancelled").map((j) => [j.id, j]))
}
