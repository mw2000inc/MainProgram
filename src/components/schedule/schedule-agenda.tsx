"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarClock, Plus, ArrowRight, Printer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { useDragHandle } from "@/components/dashboard/sortable-panel"
import { JOB_TYPE_LABELS, SCHEDULE_EXPORT_COLUMNS, formatTechnicians } from "@/components/schedule/schedule-columns"
import { useScheduleJobs, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useAuth } from "@/lib/auth/auth-context"
import { printTable } from "@/lib/export/print"
import { cn, formatDate } from "@/lib/utils"
import type { ScheduleJob } from "@/lib/types"

function MarkJobDoneDialog({
  job,
  onOpenChange,
}: {
  job: ScheduleJob | undefined
  onOpenChange: (open: boolean) => void
}) {
  const updateJob = useUpdateScheduleJob()
  const [remarks, setRemarks] = React.useState(() => job?.remarks ?? "")

  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mark Job as Done</DialogTitle>
          <DialogDescription>
            Add remarks about what was done for this {job ? JOB_TYPE_LABELS[job.jobType].toLowerCase() : "job"}.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={4}
          placeholder="What did you do on this job/errand?"
          autoFocus
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={updateJob.isPending}
            onClick={async () => {
              if (!job) return
              await updateJob.mutateAsync({ id: job.id, input: { status: "completed", remarks } })
              onOpenChange(false)
            }}
          >
            {updateJob.isPending ? "Saving..." : "Save & Mark Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// A technician may change status/remarks on a job they're assigned to (see
// the technician_job_status_update migration, which enforces the same
// column-level restriction server-side via RLS + a trigger) — everything
// else about a job (date, assignment, etc.) stays admin-only.
function canEditStatus(job: ScheduleJob, isAdmin: boolean, userId: string | undefined): boolean {
  return isAdmin || (!!userId && (job.technicianUserId === userId || job.technician2UserId === userId))
}

export function ScheduleAgenda({ date, title = "Schedule" }: { date: string; title?: string }) {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const dragHandle = useDragHandle()
  const { data: jobs = [], isPending } = useScheduleJobs()
  const updateJob = useUpdateScheduleJob()
  const [formOpen, setFormOpen] = React.useState(false)
  const [markingDone, setMarkingDone] = React.useState<ScheduleJob | undefined>(undefined)

  const todaysJobs = React.useMemo(
    () => jobs.filter((j) => j.scheduledDate === date),
    [jobs, date]
  )

  // Export/print read jobType and technician off the row directly (same
  // {header,key} pattern as every other panel's export), so swap in the
  // human label / combined technician names here rather than the raw
  // "filter_change"-style enum value or a lone primary technician.
  const exportRows = React.useMemo(
    () =>
      todaysJobs.map((j) => ({
        ...j,
        jobType: JOB_TYPE_LABELS[j.jobType],
        technician: formatTechnicians(j.technician, j.technician2),
      })),
    [todaysJobs]
  )

  function toggleComplete(job: ScheduleJob) {
    if (!canEditStatus(job, isAdmin, user?.id)) return
    if (job.status === "completed") {
      updateJob.mutate({ id: job.id, input: { status: "pending" } })
      return
    }
    setMarkingDone(job)
  }

  function handlePrint() {
    printTable({
      title: "Schedule",
      subtitle: formatDate(date),
      columns: SCHEDULE_EXPORT_COLUMNS,
      rows: exportRows,
    })
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader
        {...dragHandle}
        className={cn(
          "flex min-w-0 max-w-full flex-col items-stretch gap-2 @sm/card-header:flex-row @sm/card-header:items-center @sm/card-header:justify-between",
          dragHandle && "touch-none cursor-grab select-none active:cursor-grabbing"
        )}
      >
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">{title}</span>
        </CardTitle>
        <div className="flex min-w-0 flex-col gap-2 @xs/card-header:flex-row @xs/card-header:flex-wrap">
          {isAdmin && (
            <Button size="sm" className="gap-1.5 @xs/card-header:flex-1 @sm/card-header:flex-none" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Schedule Job
            </Button>
          )}
          {isAdmin && (
            <Link href="/schedule" className="@xs/card-header:flex-1 @sm/card-header:flex-none">
              <Button size="sm" variant="outline" className="w-full gap-1.5">
                Full Schedule <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          )}
          <div className="flex items-center gap-1">
            <PanelExportMenu columns={SCHEDULE_EXPORT_COLUMNS} rows={exportRows} fileName="schedule" />
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Print" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      {/* flex-1 + overflow-y-auto: fills whatever height this panel is
          resized to (previously this content just sat at its natural size
          under the header, leaving dead space below on a taller panel) and
          scrolls internally once the job list outgrows the available
          height. */}
      <CardContent className="flex-1 flex flex-col overflow-y-auto">
        {isPending && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {!isPending && todaysJobs.length === 0 && (
          <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground text-center">
            No jobs scheduled for this date.
          </p>
        )}
        {!isPending && todaysJobs.length > 0 && (
          <div className="divide-y">
            {todaysJobs.map((job) => (
              <div key={job.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                <Checkbox
                  checked={job.status === "completed"}
                  onCheckedChange={() => toggleComplete(job)}
                  disabled={!canEditStatus(job, isAdmin, user?.id)}
                  aria-label="Mark complete"
                  title={
                    canEditStatus(job, isAdmin, user?.id)
                      ? undefined
                      : "Only an admin or the assigned technician can change a job's status"
                  }
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-medium">{JOB_TYPE_LABELS[job.jobType]}</span>
                    {job.orderNo && <span className="text-muted-foreground">· {job.orderNo}</span>}
                  </div>
                  {/* One scheduledDate on the shared job — shown explicitly (even
                      though every row here is already scoped to this same day)
                      so a two-technician job visibly reads as one date, not two. */}
                  <p className="text-xs text-muted-foreground">{formatDate(job.scheduledDate)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatTechnicians(job.technician, job.technician2)}
                  </p>
                  {job.remarks && (
                    <p className="text-xs text-muted-foreground mt-1 italic wrap-break-word">&ldquo;{job.remarks}&rdquo;</p>
                  )}
                </div>
                <PlanStatusBadge status={job.status} />
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ScheduleFormDialog open={formOpen} onOpenChange={setFormOpen} defaultDate={date} />
      <MarkJobDoneDialog key={markingDone?.id ?? "none"} job={markingDone} onOpenChange={(o) => !o && setMarkingDone(undefined)} />
    </Card>
  )
}
