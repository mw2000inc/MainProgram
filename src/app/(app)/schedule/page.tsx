"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { CalendarClock, Plus, List, Table2, Sparkles } from "lucide-react"
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
import { ScheduleAutoSuggestDialog } from "@/components/schedule/schedule-auto-suggest-dialog"
import { TechnicianWorkloadStats } from "@/components/schedule/technician-workload-stats"
import { LastEditedIndicator } from "@/components/shared/last-edited-indicator"
import { TranslatableText } from "@/components/shared/translatable-text"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DetailField, DetailPanel, SplitViewLayout, useLatestRow, useSplitViewSelection } from "@/components/data-table/split-view"
import { ScheduleFormDialog } from "@/components/schedule/schedule-form-dialog"
import { ScheduleTableView } from "@/components/schedule/schedule-table-view"
import { getScheduleColumns, formatTechnicians, matchesTechnician, computeStopNumbers, JOB_TYPE_LABELS, SCHEDULE_EXPORT_COLUMNS } from "@/components/schedule/schedule-columns"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { PendingApprovalsPanel, usePendingApprovalsCount } from "@/components/schedule/pending-approvals-panel"
import { ScheduleMonthPicker } from "@/components/schedule/schedule-month-picker"
import { PendingScheduleApprovalPanel, usePendingScheduleApprovalCount } from "@/components/schedule/pending-schedule-approval-panel"
import { DraftAssignmentsPanel } from "@/components/schedule/draft-assignments-panel"
import {
  useApplyTechnicianAssignmentsToJobs,
  usePreviewTechnicianSuggestionsForJobs,
  useDeleteScheduleJob,
  useScheduleJobs,
} from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { formatDate, todayIso } from "@/lib/utils"
import { technicianFilterOptions, isAssignedTechnician } from "@/lib/technicians"
import { isOverdueJob } from "@/lib/scheduling/overdue"
import { businessToday } from "@/lib/dispatch-lead-time"
import type { ColumnDef } from "@tanstack/react-table"
import type { ScheduleJob, ScheduleJobType } from "@/lib/types"

// Same derivation schedule-form-dialog.tsx's own job-type Select already
// uses — a closed 6-value enum, so listing every value statically (rather
// than only options seen in the current jobs) means Collection/Repair are
// always selectable even on a day with zero of either, instead of silently
// disappearing from the dropdown.
const JOB_TYPES = Object.keys(JOB_TYPE_LABELS) as ScheduleJobType[]

const SCHEDULE_TABS = ["schedule", "pending", "pendingSchedule", "draftAssignments"] as const
type ScheduleTab = (typeof SCHEDULE_TABS)[number]

// The linked customer's own "SK001-####" order_number, never rendered as a
// column — exists purely so DataTable's generic search on the Schedule
// List view can find a job by that number too, not just its own
// "001-####" orderNo (same gap the Sep 11 Member List fix closed
// elsewhere). Kept local to this page rather than added to ScheduleRow in
// schedule-columns.tsx, since getScheduleColumns is also shared by
// PendingApprovalsPanel/PendingScheduleApprovalPanel, which pass plain
// ScheduleJob rows — widening its own exported type would break those.
type ScheduleRow = ScheduleJob & { customerOrderNumber: string }

function ScheduleContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("schedule")
  const { t: tNav } = useTranslation("nav")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: jobs = [], isPending } = useScheduleJobs()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const deleteJob = useDeleteScheduleJob()
  const previewSuggestions = usePreviewTechnicianSuggestionsForJobs()
  const applyAssignments = useApplyTechnicianAssignmentsToJobs()

  // Deep link from the Activity Log (?id=<jobId>) — opens that job's detail
  // panel directly. Only meaningful in the "list" view (see selection below);
  // the "table" view has no per-job detail panel to open into.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<ScheduleJob | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<ScheduleJob | undefined>(undefined)
  const [bulkConfirmOpen, setBulkConfirmOpen] = React.useState(false)
  const [filteredRows, setFilteredRows] = React.useState<ScheduleRow[]>([])
  const [view, setView] = React.useState<"list" | "table">("list")
  const [tableDate, setTableDate] = React.useState(todayIso)
  // The tab follows the address (?tab=pendingSchedule etc.), so a link — e.g.
  // the Daily Report's "generated drafts are waiting" note — opens it and a
  // refresh keeps it.
  const [tab, setTabState] = React.useState<ScheduleTab>(() => {
    const value = searchParams.get("tab")
    return SCHEDULE_TABS.includes(value as ScheduleTab) ? (value as ScheduleTab) : "schedule"
  })
  const setTab = (next: ScheduleTab) => {
    setTabState(next)
    const params = new URLSearchParams(window.location.search)
    if (next === "schedule") params.delete("tab")
    else params.set("tab", next)
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }
  const pendingApprovalsCount = usePendingApprovalsCount()
  const pendingScheduleApprovalCount = usePendingScheduleApprovalCount()
  // "All Technicians" by default. A shared job (technician + technician2) shows
  // up for either name — filtering by "Eubert Montalbo" surfaces a job where
  // he's only the second technician, same as if he were primary.
  const [technicianFilter, setTechnicianFilter] = React.useState<string>("all")
  // The TECHNICIANS roster, plus any other name actually on a job as its technician
  // OR technician_2 (names can be typed in now) — see technicianFilterOptions.
  const technicianOptions = React.useMemo(() => technicianFilterOptions(jobs), [jobs])
  const [jobTypeFilter, setJobTypeFilter] = React.useState<string>("all")
  // "Overdue": jobs dated before today (Manila) that aren't completed or
  // cancelled, drafts included. Opened from the Daily Report's "unfinished
  // from earlier days" link (?filter=overdue); toggling keeps the address in
  // step so a refresh keeps it.
  const [overdueOnly, setOverdueOnly] = React.useState(() => searchParams.get("filter") === "overdue")
  // One month of jobs ("YYYY-MM") or every month; kept in the address
  // (?month=2026-10) so a refresh or a shared link keeps it.
  const [monthFilter, setMonthFilterState] = React.useState(() => {
    const value = searchParams.get("month")
    return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : "all"
  })
  const setMonthFilter = (next: string) => {
    setMonthFilterState(next)
    const params = new URLSearchParams(window.location.search)
    if (next === "all") params.delete("month")
    else params.set("month", next)
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }
  const toggleOverdue = () => {
    const next = !overdueOnly
    setOverdueOnly(next)
    const params = new URLSearchParams(window.location.search)
    if (next) params.set("filter", "overdue")
    else params.delete("filter")
    const qs = params.toString()
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname)
  }

  // Folds in the linked customer's own "SK001-####" order_number (see
  // customer-lookup.ts's resolveCustomerForPlan) — this job's own orderNo
  // ("001-####") is already searchable directly, this was the missing
  // direction, same gap the Sep 11 Member List fix closed there.
  const jobsWithOrder: ScheduleRow[] = React.useMemo(
    () =>
      jobs.map((j) => ({
        ...j,
        customerOrderNumber: resolveCustomerForPlan(customers, saleListEntries, j.customerId, j.orderNo ?? "")?.orderNumber ?? "",
      })),
    [jobs, customers, saleListEntries]
  )

  // The main Schedule tab (List + Table View) shows only active/approved
  // jobs — a manually-created job still awaiting admin approval
  // ('pending_approval', see the Admin Schedule Approval workflow) lives
  // in its own "Pending Schedule Approval" tab instead, the same way an
  // unconfirmed dispatch item never reaches this list at all. Admin
  // sessions CAN read pending_approval rows (RLS lets them; a technician
  // can't), so without this filter they'd otherwise show up mixed into
  // the active schedule here.
  //
  // Pulled out of scopedJobs's own useMemo below so unassignedInView (further
  // down) can filter from this same active set directly, WITHOUT the
  // toolbar's own technicianFilter narrowing it first — see that constant's
  // own comment for why.
  const activeJobs = React.useMemo(() => jobsWithOrder.filter((j) => j.status !== "pending_approval"), [jobsWithOrder])
  const overdueJobs = React.useMemo(() => {
    const today = businessToday()
    return jobsWithOrder.filter((j) => isOverdueJob(j, today))
  }, [jobsWithOrder])

  const scopedJobs = React.useMemo(() => {
    const source = overdueOnly ? overdueJobs : activeJobs
    const byTechnician = technicianFilter === "all" ? source : source.filter((j) => matchesTechnician(j, technicianFilter))
    const byType = jobTypeFilter === "all" ? byTechnician : byTechnician.filter((j) => j.jobType === jobTypeFilter)
    const base = monthFilter === "all" ? byType : byType.filter((j) => j.scheduledDate.startsWith(monthFilter))
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
  }, [activeJobs, overdueJobs, overdueOnly, technicianFilter, jobTypeFilter, monthFilter])
  const monthsWithJobs = React.useMemo(() => new Set(activeJobs.map((j) => j.scheduledDate.slice(0, 7))), [activeJobs])

  // Deliberately from activeJobs, NOT scopedJobs — "Auto-suggest
  // technicians" (the button below) has to see every genuinely unassigned
  // job regardless of whatever the admin's own Technician filter dropdown
  // happens to be narrowed to right now, or it would silently miss real
  // unassigned jobs any time that filter isn't "all" (a blank technician
  // never matches matchesTechnician's own equality check against a specific
  // name, so a scopedJobs-based version would show 0 unassigned jobs
  // whenever a specific technician was selected, even with plenty actually
  // unassigned elsewhere). The table itself still only ever displays
  // scopedJobs; this only widens what the bulk-suggest action operates on,
  // not what's visibly listed.
  //
  // isAssignedTechnician (not a plain blank check) — confirmed live that the
  // filter-change-schedule cron which pre-creates upcoming filter_change
  // jobs ahead of their due date writes the roster's own "N/A" placeholder
  // into technician, not true blank: 26 of this app's 27 schedule_jobs rows
  // right now are exactly this (every one tagged "Auto-generated ... (CP
  // System)" in its own notes, with no location_source, distinct from a
  // real admin/auto-assigned pick). A plain `!j.technician.trim()` check
  // treats "N/A" as already-assigned (it's a non-empty string), so every one
  // of those 26 was invisible to this feature — the actual, live-data-
  // confirmed cause of "Auto-suggest technicians" reporting far fewer (often
  // zero) jobs than the N/A rows visibly sitting in the table. Pending only
  // — a completed or cancelled job with no technician isn't something to
  // suggest one for; status itself needs no case-insensitive handling here
  // (unlike technician, a free-typable field with no DB constraint) since
  // it's a Postgres enum restricted to exactly 'pending' / 'pending_approval'
  // / 'completed' / 'cancelled', always lowercase — confirmed against the
  // schema, there is no live or even reachable 'Pending' or 'auto_generated'
  // value to guard against.
  const unassignedInView = React.useMemo(
    () => activeJobs.filter((j) => !isAssignedTechnician(j.technician) && j.status === "pending"),
    [activeJobs]
  )
  // The job's customer through the same fallback chain the table's own
  // customerOrderNumber uses (resolveCustomerForPlan — the job's
  // customer_id, else its order number via the Sale List), so a job with no
  // customer_id still gets its customer's address pre-filled in the modal.
  const bulkSuggestItems = React.useMemo(
    () =>
      unassignedInView.map((j) => {
        const customer = resolveCustomerForPlan(customers, saleListEntries, j.customerId, j.orderNo ?? "")
        return {
          job: j,
          label: `${formatDate(j.scheduledDate)} · ${JOB_TYPE_LABELS[j.jobType]} · ${j.orderNo || j.customerOrderNumber || "—"}`,
          customerId: customer?.id,
          customerAddress: customer?.address?.trim() || undefined,
        }
      }),
    [unassignedInView, customers, saleListEntries]
  )

  // Same computation ScheduleAgenda uses (see computeStopNumbers' own
  // comment on why it's shared) — the List view and the Daily Report panel
  // can never disagree about which stop number a job shows.
  const stopNumberByJobId = React.useMemo(() => computeStopNumbers(scopedJobs), [scopedJobs])

  const selection = useSplitViewSelection(filteredRows, initialId)
  // Current copy of the selected row, not the one filteredRows may still
  // hold from before a save (see useLatestRow).
  const latestSelected = useLatestRow(selection.selected, jobsWithOrder)
  useDeepLinkNotFoundToast(initialId, isPending, jobs.some((j) => j.id === initialId))

  // Same {header,key} shape every other panel's export uses — swap in the
  // human job-type label and combined technician names here (same
  // transform ScheduleAgenda's own exportRows already applies) rather than
  // the raw "filter_change"-style enum value or a lone primary technician.
  // Reads filteredRows (the search box's own current result), so the
  // export matches whatever's actually on screen, same as scopedPlans on
  // the other list pages.
  const exportRows = React.useMemo(
    () =>
      filteredRows.map((j) => ({
        ...j,
        jobType: JOB_TYPE_LABELS[j.jobType],
        technician: formatTechnicians(j.technician, j.technician2),
      })),
    [filteredRows]
  )

  // getScheduleColumns is typed against plain ScheduleJob since it's also
  // shared by PendingApprovalsPanel/PendingScheduleApprovalPanel (see
  // ScheduleRow's own comment above) — cast here rather than widen that
  // shared function, since the columns it returns only ever read
  // ScheduleJob's own fields and every row this page actually hands them is
  // a real ScheduleRow at runtime regardless.
  const columns = React.useMemo(
    () =>
      getScheduleColumns({
        canDelete: isAdmin,
        onDelete: (job) => setDeleting(job),
        stopNumberByJobId,
      }) as ColumnDef<ScheduleRow, unknown>[],
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

  const selected = latestSelected

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

      <Tabs value={tab === "draftAssignments" && !isAdmin ? "schedule" : tab} onValueChange={(v) => setTab(v as ScheduleTab)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="schedule">{t("scheduleTabLabel")}</TabsTrigger>
            <TabsTrigger value="pendingSchedule">
              {t("pendingScheduleApprovalTabLabel", { count: String(pendingScheduleApprovalCount) })}
            </TabsTrigger>
            <TabsTrigger value="pending">{t("pendingApprovalsTabLabel", { count: String(pendingApprovalsCount) })}</TabsTrigger>
            {isAdmin && <TabsTrigger value="draftAssignments">{t("draftAssignmentsTabLabel")}</TabsTrigger>}
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
              {/* List view only — Table View already has its own Print
                  button for its differently-shaped, resolved-against-
                  customer/filter-change data (see ScheduleTableView), so a
                  second export here would just be confusing/redundant. */}
              {view === "list" && <PanelExportMenu columns={SCHEDULE_EXPORT_COLUMNS} rows={exportRows} fileName="schedule" />}
              {/* List view only — Table View has no equivalent "jobs in
                  view" concept to scope a bulk run to. Note unassignedInView
                  itself is intentionally NOT List-View-filter-scoped (see
                  its own comment) — this button always evaluates every
                  unassigned job app-wide, regardless of what's on screen. */}
              {isAdmin && view === "list" && (
                <Button variant="outline" className="gap-1.5" onClick={() => setBulkConfirmOpen(true)}>
                  <Sparkles className="h-4 w-4" /> {t("autoSuggestTechnicians")}
                </Button>
              )}
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

        {isAdmin && (
          <TabsContent value="draftAssignments" className="mt-4">
            <DraftAssignmentsPanel />
          </TabsContent>
        )}

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
                  pageResetKey={monthFilter}
                  toolbar={
                    <>
                      <ScheduleMonthPicker value={monthFilter} onChange={setMonthFilter} monthsWithJobs={monthsWithJobs} />
                      <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
                        <SelectTrigger className="h-9 w-45">
                          <SelectValue placeholder={t("allJobTypes")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("allJobTypes")}</SelectItem>
                          {JOB_TYPES.map((jt) => (
                            <SelectItem key={jt} value={jt}>
                              {t(jt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
                        <SelectTrigger className="h-9 w-55">
                          <SelectValue placeholder={t("allTechnicians")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("allTechnicians")}</SelectItem>
                          {technicianOptions.map((tech) => (
                            <SelectItem key={tech} value={tech}>
                              {tech}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        variant={overdueOnly ? "default" : "outline"}
                        className="h-9"
                        aria-pressed={overdueOnly}
                        onClick={toggleOverdue}
                        data-testid="schedule-overdue-filter"
                      >
                        {t("overdueFilter", { count: String(overdueJobs.length) })}
                      </Button>
                      <TechnicianWorkloadStats technician={technicianFilter} />
                    </>
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

      <ScheduleAutoSuggestDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        items={bulkSuggestItems}
        defaultErrandDate={todayIso()}
        onPreview={async (ids) => {
          const results = await previewSuggestions.mutateAsync(ids)
          return results.map(({ jobId, result }) => ({ id: jobId, result }))
        }}
        onApply={async ({ assignments, newJobs }) => {
          await applyAssignments.mutateAsync({ assignments, newJobs })
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
