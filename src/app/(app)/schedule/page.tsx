"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { CalendarClock, Plus, List, Table2 } from "lucide-react"
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
import { LastEditedIndicator } from "@/components/shared/last-edited-indicator"
import { TranslatableText } from "@/components/shared/translatable-text"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { ScheduleTableView } from "@/components/schedule/schedule-table-view"
import { getScheduleColumns, formatTechnicians, matchesTechnician, computeStopNumbers } from "@/components/schedule/schedule-columns"
import { PendingApprovalsPanel, usePendingApprovalsCount } from "@/components/schedule/pending-approvals-panel"
import { PendingScheduleApprovalPanel, usePendingScheduleApprovalCount } from "@/components/schedule/pending-schedule-approval-panel"
import { useDeleteScheduleJob, useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, todayIso } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"
import type { ScheduleJob } from "@/lib/types"

function ScheduleContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("schedule")
  const { t: tNav } = useTranslation("nav")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: jobs = [], isPending } = useScheduleJobs()
  const deleteJob = useDeleteScheduleJob()

  // Deep link from the Activity Log (?id=<jobId>) — opens that job's detail
  // panel directly. Only meaningful in the "list" view (see selection below);
  // the "table" view has no per-job detail panel to open into.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ScheduleJob | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<ScheduleJob | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<ScheduleJob[]>(jobs)
  const [view, setView] = React.useState<"list" | "table">("list")
  const [tableDate, setTableDate] = React.useState(todayIso)
  const [tab, setTab] = React.useState<"schedule" | "pending" | "pendingSchedule">("schedule")
  const pendingApprovalsCount = usePendingApprovalsCount()
  const pendingScheduleApprovalCount = usePendingScheduleApprovalCount()
  // "All Technicians" by default. A shared job (technician + technician2) shows
  // up for either name — filtering by "Eubert Montalbo" surfaces a job where
  // he's only the second technician, same as if he were primary.
  const [technicianFilter, setTechnicianFilter] = React.useState<string>("all")

  const scopedJobs = React.useMemo(() => {
    // The main Schedule tab (List + Table View) shows only active/approved
    // jobs — a manually-created job still awaiting admin approval
    // ('pending_approval', see the Admin Schedule Approval workflow) lives
    // in its own "Pending Schedule Approval" tab instead, the same way an
    // unconfirmed dispatch item never reaches this list at all. Admin
    // sessions CAN read pending_approval rows (RLS lets them; a technician
    // can't), so without this filter they'd otherwise show up mixed into
    // the active schedule here.
    const active = jobs.filter((j) => j.status !== "pending_approval")
    const base = technicianFilter === "all" ? active : active.filter((j) => matchesTechnician(j, technicianFilter))
    // Default display order only — column-header sorting (DataTable's own
    // sorting state) still takes over the instant an admin clicks a column,
    // exactly as before. Grouped by technician, then date, then
    // route_sequence, so a technician's stops for one day land on
    // consecutive rows with Stop 1/2/3 reading in order — the same grouping
    // ScheduleAgenda applies for a single day, just extended across every
    // date this flat, all-dates table shows at once. A job the automation
    // hasn't placed (routeSequence null) simply falls back to whatever
    // order it was already in within its technician+date group.
    return [...base].sort((a, b) => {
      if (a.technician !== b.technician) return a.technician.localeCompare(b.technician)
      if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate)
      if (a.routeSequence == null && b.routeSequence == null) return 0
      if (a.routeSequence == null) return 1
      if (b.routeSequence == null) return -1
      return a.routeSequence - b.routeSequence
    })
  }, [jobs, technicianFilter])

  // Same computation ScheduleAgenda uses (see computeStopNumbers' own
  // comment on why it's shared) — the List view and the Daily Report panel
  // can never disagree about which stop number a job shows.
  const stopNumberByJobId = React.useMemo(() => computeStopNumbers(scopedJobs), [scopedJobs])

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, jobs.some((j) => j.id === initialId))

  const columns = React.useMemo(
    () =>
      getScheduleColumns({
        canDelete: isAdmin,
        onDelete: (job) => setDeleting(job),
        stopNumberByJobId,
      }),
    [isAdmin, stopNumberByJobId]
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
            <CalendarClock className="h-6 w-6 text-primary" /> {tNav("schedule")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "schedule" | "pending" | "pendingSchedule")}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="schedule">{t("scheduleTabLabel")}</TabsTrigger>
            <TabsTrigger value="pendingSchedule">
              {t("pendingScheduleApprovalTabLabel", { count: String(pendingScheduleApprovalCount) })}
            </TabsTrigger>
            <TabsTrigger value="pending">{t("pendingApprovalsTabLabel", { count: String(pendingApprovalsCount) })}</TabsTrigger>
          </TabsList>
          {tab === "schedule" && (
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border p-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant={view === "list" ? "default" : "ghost"}
                  className="gap-1.5"
                  onClick={() => setView("list")}
                >
                  <List className="h-3.5 w-3.5" /> {t("list")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={view === "table" ? "default" : "ghost"}
                  className="gap-1.5"
                  onClick={() => setView("table")}
                >
                  <Table2 className="h-3.5 w-3.5" /> {t("tableView")}
                </Button>
              </div>
              {isAdmin && (
                <Button
                  className="gap-1.5"
                  onClick={() => {
                    setEditing(undefined)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> {t("scheduleJob")}
                </Button>
              )}
            </div>
          )}
        </div>

        <TabsContent value="pendingSchedule" className="mt-4">
          <PendingScheduleApprovalPanel />
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <PendingApprovalsPanel />
        </TabsContent>

        <TabsContent value="schedule" className="mt-4">
      {view === "table" ? (
          <ScheduleTableView date={tableDate} onDateChange={setTableDate} />
        ) : (
          <SplitViewLayout
          isOpen={selection.isOpen}
          expanded={selection.expanded}
          list={
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  columns={columns}
                  data={scopedJobs}
                  searchPlaceholder={t("searchByTechnicianOrderNotes")}
                  emptyMessage={t("noScheduledJobsFound")}
                  onFilteredRowsChange={setFilteredRows}
                  onRowClick={(row) => selection.open(row)}
                  toolbar={
                    <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
                      <SelectTrigger className="h-9 w-[220px]">
                        <SelectValue placeholder={t("allTechnicians")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("allTechnicians")}</SelectItem>
                        {TECHNICIANS.map((tech) => (
                          <SelectItem key={tech} value={tech}>
                            {tech}
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
                title={t(selected.jobType)}
                icon={CalendarClock}
                subtitle={selected.orderNo || formatTechnicians(selected.technician, selected.technician2, t("and"))}
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
                <DetailField label={t("date")} value={formatDate(selected.scheduledDate)} />
                <DetailField label={t("time")} value={selected.scheduledTime} />
                <DetailField label={t("jobType")} value={t(selected.jobType)} />
                <DetailField
                  label={t("technician")}
                  value={formatTechnicians(selected.technician, selected.technician2, t("and"))}
                />
                <DetailField label={tFields("orderNo")} value={selected.orderNo} />
                <DetailField label={tFields("status")} value={tStatus(selected.status)} />
                <DetailField
                  label={tFields("note")}
                  value={
                    selected.notes && (
                      <TranslatableText entityType="schedule_jobs" entityId={selected.id} fieldName="notes" text={selected.notes} />
                    )
                  }
                  className="sm:col-span-2"
                />
                <DetailField label={t("secondaryAddress")} value={selected.secondaryAddress} className="sm:col-span-2" />
                <DetailField
                  label={t("remarks")}
                  value={
                    selected.remarks && (
                      <TranslatableText entityType="schedule_jobs" entityId={selected.id} fieldName="remarks" text={selected.remarks} />
                    )
                  }
                  className="sm:col-span-2"
                />
                <LastEditedIndicator entityType="schedule_jobs" entityId={selected.id} className="text-xs text-muted-foreground sm:col-span-2" />
              </DetailPanel>
            )
          }
        />
      )}
        </TabsContent>
      </Tabs>

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={todayIso()}
        job={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteJobTitle")}
        description={t("deleteJobDescription")}
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

function ScheduleFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function SchedulePage() {
  return (
    <React.Suspense fallback={<ScheduleFallback />}>
      <ScheduleContent />
    </React.Suspense>
  )
}
