"use client"

import * as React from "react"
import { CalendarClock, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { getScheduleColumns } from "@/components/schedule/schedule-columns"
import { useDeleteScheduleJob, useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useAuth } from "@/lib/auth/auth-context"
import type { ScheduleJob } from "@/lib/types"

export default function SchedulePage() {
  const { user } = useAuth()
  const { data: jobs = [], isPending } = useScheduleJobs()
  const deleteJob = useDeleteScheduleJob()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<ScheduleJob | undefined>(undefined)

  const columns = React.useMemo(
    () =>
      getScheduleColumns({
        canDelete: user?.role === "admin",
        onDelete: (job) => setDeleting(job),
      }),
    [user?.role]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" /> Schedule
          </h1>
          <p className="text-sm text-muted-foreground">Technician job agenda across all dates.</p>
        </div>
        <Button className="gap-1.5" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" /> Schedule Job
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={jobs}
            searchPlaceholder="Search by technician, order no, notes..."
            emptyMessage="No scheduled jobs found."
          />
        </CardContent>
      </Card>

      <ScheduleFormDialog open={formOpen} onOpenChange={setFormOpen} defaultDate={new Date().toISOString().slice(0, 10)} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this job?"
        description="This will permanently remove this scheduled job."
        loading={deleteJob.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deleteJob.mutateAsync(deleting.id)
          setDeleting(undefined)
        }}
      />
    </div>
  )
}
