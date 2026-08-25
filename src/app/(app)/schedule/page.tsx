"use client"

import * as React from "react"
import { CalendarClock, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { getScheduleColumns, JOB_TYPE_LABELS, formatTechnicians } from "@/components/schedule/schedule-columns"
import { useDeleteScheduleJob, useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDate } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"
import type { ScheduleJob } from "@/lib/types"

export default function SchedulePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: jobs = [], isPending } = useScheduleJobs()
  const deleteJob = useDeleteScheduleJob()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ScheduleJob | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<ScheduleJob | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<ScheduleJob[]>(jobs)
  // "All Technicians" by default. A shared job (technician + technician2) shows
  // up for either name — filtering by "Eubert Montalbo" surfaces a job where
  // he's only the second technician, same as if he were primary.
  const [technicianFilter, setTechnicianFilter] = React.useState<string>("all")

  const scopedJobs = React.useMemo(() => {
    if (technicianFilter === "all") return jobs
    return jobs.filter((j) => j.technician === technicianFilter || j.technician2 === technicianFilter)
  }, [jobs, technicianFilter])

  const selection = useSplitViewSelection(filteredRows)

  const columns = React.useMemo(
    () =>
      getScheduleColumns({
        canDelete: isAdmin,
        onDelete: (job) => setDeleting(job),
      }),
    [isAdmin]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = selection.selected

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" /> Schedule
          </h1>
          <p className="text-sm text-muted-foreground">Technician job agenda across all dates.</p>
        </div>
        {isAdmin && (
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Schedule Job
          </Button>
        )}
      </div>

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        list={
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={columns}
                data={scopedJobs}
                searchPlaceholder="Search by technician, order no, notes..."
                emptyMessage="No scheduled jobs found."
                onFilteredRowsChange={setFilteredRows}
                onRowClick={(row) => selection.open(row)}
                toolbar={
                  <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
                    <SelectTrigger className="h-9 w-[220px]">
                      <SelectValue placeholder="All Technicians" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Technicians</SelectItem>
                      {TECHNICIANS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </CardContent>
          </Card>
        }
        detail={
          selected && (
            <DetailPanel
              title={JOB_TYPE_LABELS[selected.jobType]}
              icon={CalendarClock}
              subtitle={selected.orderNo || formatTechnicians(selected.technician, selected.technician2)}
              onEdit={
                isAdmin
                  ? () => {
                      setEditing(selected)
                      setFormOpen(true)
                    }
                  : undefined
              }
              onDelete={isAdmin ? () => setDeleting(selected) : undefined}
              onPrev={selection.prev}
              onNext={selection.next}
              hasPrev={selection.hasPrev}
              hasNext={selection.hasNext}
              expanded={selection.expanded}
              onToggleExpand={() => selection.setExpanded((v) => !v)}
              onClose={selection.close}
            >
              <DetailField label="Date" value={formatDate(selected.scheduledDate)} />
              <DetailField label="Job Type" value={JOB_TYPE_LABELS[selected.jobType]} />
              <DetailField label="Technician" value={formatTechnicians(selected.technician, selected.technician2)} />
              <DetailField label="Order No" value={selected.orderNo} />
              <DetailField label="Status" value={selected.status} />
              <DetailField label="Notes" value={selected.notes} className="sm:col-span-2" />
              <DetailField label="Remarks" value={selected.remarks} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={new Date().toISOString().slice(0, 10)}
        job={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this job?"
        description="This will permanently remove this scheduled job."
        loading={deleteJob.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deleteJob.mutateAsync(deleting.id)
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />
    </div>
  )
}
