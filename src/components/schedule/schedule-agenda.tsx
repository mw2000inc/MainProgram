"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarClock, CheckCheck, Plus, ArrowRight, Printer, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { JOB_TYPE_LABELS, SCHEDULE_EXPORT_COLUMNS, formatTechnicians, computeStopNumbers } from "@/components/schedule/schedule-columns"
import { useCompleteScheduleJobs, useScheduleJobs, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useCreateScheduleJobFilterItems } from "@/lib/hooks/use-schedule-job-filter-items"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { printTable } from "@/lib/export/print"
import { cn, formatDate, todayIso } from "@/lib/utils"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { isAssignedTechnician } from "@/lib/technicians"
import type { ScheduleJob } from "@/lib/types"

type FilterItemDraft = { key: number; productId: string; quantity: string }
let filterItemDraftKey = 0

// Filters recorded here automatically create/update this job's Filter
// Change and Collection records and a pending (not-yet-deducted) inventory
// transaction per item — see the ct_filter_change_collection_inventory_link
// migration. Available for any job type, not just "filter_change": a
// technician can notice the same need during a repair or install visit.
function MarkJobDoneDialog({
  job,
  onOpenChange,
}: {
  job: ScheduleJob | undefined
  onOpenChange: (open: boolean) => void
}) {
  const updateJob = useUpdateScheduleJob()
  const createFilterItems = useCreateScheduleJobFilterItems()
  const { data: products = [] } = useProducts()
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const [remarks, setRemarks] = React.useState(() => job?.remarks ?? "")
  const [filterChangeRequired, setFilterChangeRequired] = React.useState(false)
  const [filterItems, setFilterItems] = React.useState<FilterItemDraft[]>([
    { key: filterItemDraftKey++, productId: "", quantity: "1" },
  ])

  const saving = updateJob.isPending || createFilterItems.isPending

  function updateItem(key: number, patch: Partial<FilterItemDraft>) {
    setFilterItems((items) => items.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  return (
    <Dialog open={!!job} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("markJobAsDone")}</DialogTitle>
          <DialogDescription>
            {t("addRemarksAbout", { jobType: (job ? t(job.jobType) : t("job")).toLowerCase() })}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={4}
          placeholder={t("whatDidYouDo")}
          autoFocus
        />

        <div className="space-y-3 rounded-md border p-3">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <Checkbox checked={filterChangeRequired} onCheckedChange={(v) => setFilterChangeRequired(v === true)} />
            {t("filterChangeRequired")}
          </label>
          {filterChangeRequired && (
            <div className="space-y-2">
              {filterItems.map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  <Select value={item.productId} onValueChange={(v) => updateItem(item.key, { productId: v })}>
                    <SelectTrigger className="flex-1 min-w-0">
                      <SelectValue placeholder={t("selectFilter")} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                    className="w-16 shrink-0"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-danger hover:text-danger"
                    disabled={filterItems.length === 1}
                    onClick={() => setFilterItems((items) => items.filter((i) => i.key !== item.key))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setFilterItems((items) => [...items, { key: filterItemDraftKey++, productId: "", quantity: "1" }])}
              >
                <Plus className="h-3.5 w-3.5" /> {t("addFilter")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("pendingInventoryNote")}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              if (!job) return
              const items = filterChangeRequired
                ? filterItems
                    .filter((i) => i.productId && Number(i.quantity) > 0)
                    .map((i) => ({ productId: i.productId, quantity: Number(i.quantity) }))
                : []
              await updateJob.mutateAsync({ id: job.id, input: { status: "completed", remarks } })
              if (items.length > 0) {
                await createFilterItems.mutateAsync({ scheduleJobId: job.id, items })
              }
              onOpenChange(false)
            }}
          >
            {saving ? t("saving") : t("saveAndMarkDone")}
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
  const { t } = useTranslation("schedule")
  const { data: jobs = [], isPending } = useScheduleJobs()
  const updateJob = useUpdateScheduleJob()
  const [formOpen, setFormOpen] = React.useState(false)
  // Full-screen view of this day's schedule (the header's expand toggle).
  const [expanded, setExpanded] = React.useState(false)
  // Full-screen batch completion (admins): which pending jobs are selected,
  // and the confirmation. Cleared whenever the full-screen view closes.
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [confirmComplete, setConfirmComplete] = React.useState(false)
  const completeJobs = useCompleteScheduleJobs()
  const [editingJob, setEditingJob] = React.useState<ScheduleJob | undefined>(undefined)
  const [markingDone, setMarkingDone] = React.useState<ScheduleJob | undefined>(undefined)

  function openCreate() {
    setEditingJob(undefined)
    setFormOpen(true)
  }

  function openEdit(job: ScheduleJob) {
    if (!isAdmin) return
    setEditingJob(job)
    setFormOpen(true)
  }

  // Grouped by technician, then by routeSequence within that technician's
  // day (nulls last — a job the automation hasn't placed, or one that
  // predates this feature, just falls back to whatever order it was
  // already in rather than being treated as "first"). Purely a display
  // order; the ScheduleFormDialog admins already use to reassign anything
  // is completely unaffected.
  const todaysJobs = React.useMemo(() => {
    // Excludes a manually-created job still awaiting admin approval
    // ('pending_approval', see the Admin Schedule Approval workflow) — this
    // agenda represents the active technician schedule, and RLS already
    // keeps a technician from ever fetching such a row at all; an admin's
    // own session can read it (is_admin() bypasses that), so it still needs
    // filtering out here or it would show up mixed into "today's schedule"
    // for the admin viewing their own Daily Report.
    //
    // technicianUserId/technician2UserId — belt-and-suspenders, not the
    // real enforcement: schedule_jobs_select RLS (see the technician_role
    // and schedule_pending_approval_rls_and_dedup migrations) already
    // restricts a technician's own session to `technician_user_id =
    // auth.uid() OR technician_2_user_id = auth.uid()`, so useScheduleJobs()
    // never actually returns another technician's job to begin with —
    // confirmed live (a real temp technician account, signed in via the
    // anon client, querying schedule_jobs directly) rather than assumed.
    // This client-side check is still worth keeping explicit here: it
    // documents the intended behavior right where it's displayed, and
    // keeps this one view correct on its own even if a future RLS change
    // ever loosened the server-side policy. An admin still sees every
    // technician's jobs, same as before.
    const filtered = jobs.filter(
      (j) =>
        j.scheduledDate === date &&
        j.status !== "pending_approval" &&
        (isAdmin || j.technicianUserId === user?.id || j.technician2UserId === user?.id)
    )
    return [...filtered].sort((a, b) => {
      if (a.technician !== b.technician) return a.technician.localeCompare(b.technician)
      if (a.routeSequence == null && b.routeSequence == null) return 0
      if (a.routeSequence == null) return 1
      if (b.routeSequence == null) return -1
      return a.routeSequence - b.routeSequence
    })
  }, [jobs, date, isAdmin, user?.id])

  // Display-only "Stop 1, Stop 2, ..." per technician for this one day —
  // same computation the Schedule page's List view uses (see
  // computeStopNumbers' own comment on why it's shared), so the two can
  // never disagree about which stop number a given job shows.
  const stopNumberByJobId = React.useMemo(() => computeStopNumbers(todaysJobs), [todaysJobs])

  // Technician group boundaries within todaysJobs' own sort order above —
  // just the index of each first-of-a-technician row, so the list below can
  // drop a "TECHNICIAN" header exactly there without a second data
  // structure duplicating todaysJobs itself.
  const technicianHeaderAt = React.useMemo(() => {
    const set = new Set<number>()
    let last: string | undefined
    todaysJobs.forEach((job, i) => {
      if (job.technician !== last) set.add(i)
      last = job.technician
    })
    return set
  }, [todaysJobs])

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

  // One block per technician for the card's stacked list (todaysJobs is
  // already sorted by technician); the full-screen view groups differently,
  // see fullScreenSections.
  const technicianGroups = React.useMemo(() => {
    const groups: { key: string; technician: string; jobs: typeof todaysJobs }[] = []
    todaysJobs.forEach((job, i) => {
      if (technicianHeaderAt.has(i) || groups.length === 0) groups.push({ key: `${job.technician}-${i}`, technician: job.technician, jobs: [] })
      groups[groups.length - 1].jobs.push(job)
    })
    return groups
  }, [todaysJobs, technicianHeaderAt])

  // selectMode (the full-screen view, for an admin): a pending job's box
  // selects it for the batch Mark as Completed instead of opening the
  // single-job Mark done dialog; a completed job's box just shows it's done.
  const renderJob = (job: (typeof todaysJobs)[number], first: boolean, selectMode = false) => (
    <div className={cn("flex items-start gap-3 py-2.5", !first && "border-t")}>
    {selectMode ? (
      <Checkbox
        checked={job.status === "completed" || selected.has(job.id)}
        onCheckedChange={() => toggleSelected(job.id)}
        disabled={job.status !== "pending"}
        aria-label={t("selectJob")}
        data-testid="schedule-select-job"
        className="mt-0.5"
      />
    ) : (
    <Checkbox
      checked={job.status === "completed"}
      onCheckedChange={() => toggleComplete(job)}
      disabled={!canEditStatus(job, isAdmin, user?.id)}
      aria-label={t("markComplete")}
      title={
        canEditStatus(job, isAdmin, user?.id)
          ? undefined
          : t("onlyAdminOrAssignedTechnician")
      }
      className="mt-0.5"
    />
    )}
    <div
      className={cn("flex-1 min-w-0 flex items-start gap-3", isAdmin && "cursor-pointer")}
      onClick={isAdmin ? () => openEdit(job) : undefined}
      title={isAdmin ? t("clickToEditJob") : undefined}
    >
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{t(job.jobType)}</span>
          {job.orderNo && <span className="text-muted-foreground">· {job.orderNo}</span>}
        </div>
        {/* One scheduledDate on the shared job — shown explicitly (even
            though every row here is already scoped to this same day)
            so a two-technician job visibly reads as one date, not two. */}
        <p className="text-xs text-muted-foreground">
          {formatDate(job.scheduledDate)}
          {job.scheduledTime && <span> · {job.scheduledTime}</span>}
        </p>
        {/* What the technician needs on the day — set from the
            Auto-suggest modal (or the job form): where to go,
            which filters to bring, and the task itself (a custom
            errand's description lives in notes). */}
        {job.secondaryAddress && (
          <p className="text-xs text-muted-foreground wrap-break-word">{job.secondaryAddress}</p>
        )}
        {job.filterCodes && (
          <p className="text-xs text-muted-foreground">
            {t("editFilters")}: <span className="font-medium text-foreground">{job.filterCodes}</span>
          </p>
        )}
        {job.notes && <p className="text-xs wrap-break-word">{job.notes}</p>}
        <p className="text-xs text-muted-foreground truncate">
          {formatTechnicians(job.technician, job.technician2, t("and"))}
          {stopNumberByJobId.has(job.id) && (
            <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
              {t("routeStop", { n: String(stopNumberByJobId.get(job.id)) })}
            </span>
          )}
        </p>
        {job.locationSource === "unavailable" && (
          <p className="text-xs text-warning">{t("locationUnavailableAdminReview")}</p>
        )}
        {job.remarks && (
          <p className="text-xs text-muted-foreground mt-1 italic wrap-break-word">&ldquo;{job.remarks}&rdquo;</p>
        )}
      </div>
      <PlanStatusBadge status={job.status} />
    </div>
    </div>
  )

  // Full-screen layout. Assigned jobs go under their technician; unassigned
  // ones (blank / "N/A") under one "Unassigned / Pending Assignment" section.
  // Several technicians -> one column each; a lone technician's jobs, and the
  // unassigned ones, are tiled across the whole width instead of stacking in
  // one narrow column. Every layout is the same auto-fill grid of 320px+
  // tracks, so it fills whatever width the screen has.
  const fullScreenSections = React.useMemo(() => {
    const byTechnician = new Map<string, typeof todaysJobs>()
    const unassigned: typeof todaysJobs = []
    for (const job of todaysJobs) {
      if (!isAssignedTechnician(job.technician)) {
        unassigned.push(job)
        continue
      }
      const name = job.technician.trim()
      const list = byTechnician.get(name) ?? []
      list.push(job)
      byTechnician.set(name, list)
    }
    return { assigned: [...byTechnician.entries()].map(([technician, jobs]) => ({ technician, jobs })), unassigned }
  }, [todaysJobs])

  const gridClass = "grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]"
  const selectMode = isAdmin
  const pendingInView = React.useMemo(() => todaysJobs.filter((j) => j.status === "pending"), [todaysJobs])
  const toggleSelected = (id: string) =>
    setSelected((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // Select / clear every pending job in a section (or the whole view).
  const toggleSelectAll = (jobs: typeof todaysJobs) => {
    const ids = jobs.filter((j) => j.status === "pending").map((j) => j.id)
    setSelected((old) => {
      const allSelected = ids.length > 0 && ids.every((id) => old.has(id))
      const next = new Set(old)
      for (const id of ids) allSelected ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAllState = (jobs: typeof todaysJobs): boolean | "indeterminate" => {
    const ids = jobs.filter((j) => j.status === "pending").map((j) => j.id)
    const n = ids.filter((id) => selected.has(id)).length
    return n === 0 ? false : n === ids.length ? true : "indeterminate"
  }
  // Selected jobs if any, else every pending job in view.
  const completionTargets = selected.size > 0 ? pendingInView.filter((j) => selected.has(j.id)) : pendingInView

  const sectionHeader = (label: string, count: number, testId: string, jobs?: typeof todaysJobs) => (
    <div data-testid={testId} className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {selectMode && jobs && jobs.some((j) => j.status === "pending") && (
        <Checkbox
          checked={selectAllState(jobs)}
          onCheckedChange={() => toggleSelectAll(jobs)}
          aria-label={t("selectAllInSection", { section: label })}
        />
      )}
      {label}
      <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-semibold">
        {count}
      </Badge>
    </div>
  )
  const tiles = (jobs: typeof todaysJobs, testId: string) => (
    <div className={gridClass}>
      {jobs.map((job) => (
        <div key={job.id} data-testid={testId} className="rounded-md border px-3">
          {renderJob(job, true, selectMode)}
        </div>
      ))}
    </div>
  )

  const fullScreenJobs = () => {
    if (isPending || todaysJobs.length === 0) return jobList()
    const { assigned, unassigned } = fullScreenSections
    return (
      <div className="space-y-6">
        {assigned.length > 1 && (
          <div className={gridClass}>
            {assigned.map((group) => (
              <div key={group.technician} data-testid="schedule-technician-column" className="rounded-md border p-3">
                {sectionHeader(group.technician, group.jobs.length, "schedule-section-header", group.jobs)}
                {group.jobs.map((job, j) => (
                  <React.Fragment key={job.id}>{renderJob(job, j === 0, selectMode)}</React.Fragment>
                ))}
              </div>
            ))}
          </div>
        )}
        {assigned.length === 1 && (
          <section>
            {sectionHeader(assigned[0].technician, assigned[0].jobs.length, "schedule-section-header", assigned[0].jobs)}
            {tiles(assigned[0].jobs, "schedule-job-tile")}
          </section>
        )}
        {unassigned.length > 0 && (
          <section>
            {sectionHeader(t("unassignedPendingAssignment"), unassigned.length, "schedule-section-header", unassigned)}
            {tiles(unassigned, "schedule-job-tile")}
          </section>
        )}
      </div>
    )
  }

  const jobList = () => (
    <>
      {isPending && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!isPending && todaysJobs.length === 0 && (
        <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground text-center">
          {t("noJobsScheduled")}
        </p>
      )}
      {!isPending && todaysJobs.length > 0 && (
        <div>
          {technicianGroups.map((group, g) => (
            <div key={group.key} className={cn(g > 0 && "pt-3")}>
              <div className="flex items-center gap-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.technician || t("unassigned")}
              </div>
              {group.jobs.map((job, j) => (
                <React.Fragment key={job.id}>{renderJob(job, j === 0)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )

  const headerActions = (
    <div className="flex min-w-0 flex-col gap-2 @xs/card-header:flex-row @xs/card-header:flex-wrap sm:flex-row sm:flex-wrap sm:items-center">
      {isAdmin && (
        <Button size="sm" className="gap-1.5 @xs/card-header:flex-1 @sm/card-header:flex-none" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> {t("scheduleJob")}
        </Button>
      )}
      {isAdmin && (
        <Link href="/schedule" className="@xs/card-header:flex-1 @sm/card-header:flex-none">
          <Button size="sm" variant="outline" className="w-full gap-1.5">
            {t("fullSchedule")} <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      )}
      <div className="flex items-center gap-1">
        <PanelExportMenu columns={SCHEDULE_EXPORT_COLUMNS} rows={exportRows} fileName="schedule" />
        <Button variant="ghost" size="icon" className="h-7 w-7" title={t("print")} onClick={handlePrint}>
          <Printer className="h-3.5 w-3.5" />
        </Button>
        <FullScreenToggleButton isFullScreen={expanded} onToggle={() => setExpanded((v) => !v)} />
      </div>
    </div>
  )

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
        {headerActions}
      </CardHeader>
      {/* flex-1 + overflow-y-auto: fills whatever height this panel is
          resized to and scrolls internally once the job list outgrows it. */}
      <CardContent className="flex-1 flex flex-col overflow-y-auto">{jobList()}</CardContent>

      {/* Full-screen view: the same day's schedule in a full-window dialog
          (a portal, so the dashboard grid's drag/resize transforms can't
          clip it), assigned technicians in columns, unassigned jobs tiled. The toggle
          button, Escape or X restore the card. */}
      <Dialog
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open)
          if (!open) setSelected(new Set())
        }}
      >
        <DialogContent
          className="inset-0 top-0 left-0 flex h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
        >
          <DialogHeader className="flex flex-col gap-2 border-b p-4 pr-12 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" /> {title}
              <span className="text-sm font-normal text-muted-foreground">· {formatDate(date)}</span>
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2">
              {selectMode && pendingInView.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selectAllState(todaysJobs)} onCheckedChange={() => toggleSelectAll(todaysJobs)} aria-label={t("selectAllPending")} />
                    {t("selectAllPending")}
                  </label>
                  <Button size="sm" className="gap-1.5" disabled={completeJobs.isPending} onClick={() => setConfirmComplete(true)}>
                    <CheckCheck className="h-3.5 w-3.5" />
                    {selected.size > 0
                      ? t("markSelectedCompleted", { count: String(completionTargets.length) })
                      : t("completeAllPending", { count: String(pendingInView.length) })}
                  </Button>
                </>
              )}
              {headerActions}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="schedule-fullscreen-body">
            {fullScreenJobs()}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title={t("batchCompleteTitle")}
        description={t("batchCompleteDescription", { count: String(completionTargets.length), date: formatDate(todayIso()) })}
        confirmLabel={t("batchCompleteConfirm")}
        destructive={false}
        loading={completeJobs.isPending}
        onConfirm={async () => {
          await completeJobs
            .mutateAsync({ jobIds: completionTargets.map((j) => j.id), today: todayIso() })
            .then(() => setSelected(new Set()))
            .catch(() => {})
          setConfirmComplete(false)
        }}
      />

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditingJob(undefined)
        }}
        defaultDate={date}
        job={editingJob}
      />
      <MarkJobDoneDialog key={markingDone?.id ?? "none"} job={markingDone} onOpenChange={(o) => !o && setMarkingDone(undefined)} />
    </Card>
  )
}
