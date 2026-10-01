"use client"

import * as React from "react"
import Link from "next/link"
import { CalendarClock, CheckCheck, LayoutGrid, Pencil, Plus, ArrowRight, Printer, Rows3, Search, Trash2, X } from "lucide-react"
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
import { useCustomers } from "@/lib/hooks/use-customers"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { printTable } from "@/lib/export/print"
import { cn, formatDate, todayIso } from "@/lib/utils"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { crewForVehicle, isAssignedTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { InlineComboboxCell, InlineDateCell, InlineTextAreaCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { useUsers } from "@/lib/hooks/use-misc"
import { VEHICLE_TYPES } from "@/lib/constants"
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

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

type StatusFilter = "all" | "pending" | "completed"
type ViewMode = "grid" | "table"
const VIEW_MODE_KEY = "schedule-fullscreen-view"
const TABLE_COLUMN_LABEL = {
  date: "tableDate",
  jobType: "tableJobType",
  technician: "tableTechnician",
  vehicle: "tableVehicle",
  orderNo: "tableOrderNo",
  status: "tableStatus",
  notes: "tableNotes",
  remarks: "tableRemarks",
} as const
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = { all: "statusFilterAll", pending: "statusFilterPending", completed: "statusFilterCompleted" }

// Table View cells an admin can edit in place (double-click).
type EditableField = "date" | "jobType" | "technician" | "vehicle" | "orderNo" | "status" | "notes" | "remarks"

// Where a cell editor's own dropdowns render (Radix portals outside the
// table) — focus moving into one of these is still "inside" the editor.
const EDITOR_PORTAL_SELECTOR = "[data-radix-popper-content-wrapper], [data-slot=popover-content], [data-slot=select-content], [role=listbox]"

// A Table View cell: shows its value, and for admins turns into its editor
// on double-click. The editor saves on its own (blur, Enter or a pick); the
// cell closes again once focus leaves it — clicking elsewhere, Tab, or
// Escape — so a save never waits on an extra "done" step.
function EditableCell({
  enabled,
  editing,
  onStart,
  onStop,
  hint,
  className,
  display,
  children,
}: {
  enabled: boolean
  editing: boolean
  onStart: () => void
  onStop: () => void
  hint: string
  className?: string
  display: React.ReactNode
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLTableCellElement>(null)
  React.useEffect(() => {
    if (editing) ref.current?.querySelector<HTMLElement>("input, textarea, button")?.focus()
  }, [editing])
  // After the editor's own blur/keydown handling (its save) has run.
  const stopSoon = () => setTimeout(onStop, 0)
  return (
    <td
      ref={ref}
      data-editing={editing || undefined}
      className={cn("px-3 py-2", enabled && !editing && "cursor-text hover:bg-primary/5", className)}
      title={enabled && !editing ? hint : undefined}
      onDoubleClick={enabled && !editing ? onStart : undefined}
      onKeyDown={editing ? (e) => e.key === "Escape" && stopSoon() : undefined}
      onBlur={
        editing
          ? (e) => {
              const next = e.relatedTarget as HTMLElement | null
              if (next && (e.currentTarget.contains(next) || next.closest(EDITOR_PORTAL_SELECTOR))) return
              stopSoon()
            }
          : undefined
      }
    >
      {editing ? children : display}
    </td>
  )
}

// A small labelled select for a table cell (Job Type, Status) — saves the
// moment a value is picked.
function CellSelect<V extends string>({
  value,
  options,
  onCommit,
  className,
}: {
  value: V
  options: { value: V; label: string }[]
  onCommit: (next: V) => void
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== value && onCommit(v as V)}>
      <SelectTrigger size="sm" className={cn("h-7 w-[150px] text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const JOB_TYPES: ScheduleJobType[] = ["installation", "filter_change", "repair", "collection", "monitoring", "other"]
const STATUS_LABEL_KEY: Record<ScheduleJobStatus, string> = {
  pending: "pending",
  pending_approval: "pendingApproval",
  completed: "completed",
  cancelled: "cancelled",
}
const VEHICLE_OPTIONS = VEHICLE_TYPES.map((v) => ({ value: v }))

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
  // Full-screen search (cleared when the view closes).
  const [search, setSearch] = React.useState("")
  // Full-screen status filter — Pending by default, so the grid shows the
  // jobs still to do (reset to it whenever the view closes).
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("pending")
  // Grid (cards) or Table — remembered per browser; storage can be blocked,
  // in which case it just starts on Grid every time.
  const [viewMode, setViewModeState] = React.useState<ViewMode>(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(VIEW_MODE_KEY) === "table" ? "table" : "grid"
    } catch {
      return "grid"
    }
  })
  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode)
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // ignore — the choice just won't be remembered
    }
  }
  const { data: customers = [] } = useCustomers()
  const completeJobs = useCompleteScheduleJobs()
  const [editingJob, setEditingJob] = React.useState<ScheduleJob | undefined>(undefined)
  const [markingDone, setMarkingDone] = React.useState<ScheduleJob | undefined>(undefined)
  const { t: tStatus } = useTranslation("status")
  const { t: tCommon } = useTranslation("common")

  // Table View inline editing (admins). Each change saves straight away;
  // the database then carries date / technician changes to the job's linked
  // Filter Change / install / repair / collection record, and every open
  // Daily Report refreshes through useLiveDataSync.
  const { data: users = [] } = useUsers()
  const technicianAccounts = React.useMemo(() => users.filter((u) => u.role === "technician"), [users])
  const [editingCell, setEditingCell] = React.useState<{ jobId: string; field: EditableField } | null>(null)
  const saveJob = (job: ScheduleJob, input: Partial<Omit<ScheduleJob, "id" | "createdAt">>) => updateJob.mutate({ id: job.id, input })
  // A technician change also re-links the technicians' logins by name, so the
  // job shows in the right technician's own Daily Report (never the
  // previous technician's).
  const technicianInput = (primary: string, secondary: string) => {
    const pair = normalizeTechnicianPair(primary, secondary)
    return { technician: pair.primary, technician2: pair.secondary, ...technicianAccountIds(pair.primary, pair.secondary, technicianAccounts) }
  }
  // A vehicle with a fixed crew (the Liteace) brings its two technicians.
  const saveVehicle = (job: ScheduleJob, vehicle: string) => {
    const crew = crewForVehicle(vehicle)
    saveJob(job, { vehicle, ...(crew ? technicianInput(crew.primary, crew.secondary) : {}) })
  }
  // Pending -> Completed goes through the same completion as the batch
  // "Mark as Completed", so the linked record is completed (and its items
  // queued for inventory approval) too; any other change is a plain save.
  const saveStatus = (job: ScheduleJob, status: ScheduleJobStatus) => {
    if (job.status === "pending" && status === "completed") completeJobs.mutate({ jobIds: [job.id], today: todayIso() })
    else saveJob(job, { status })
  }
  const cellProps = (job: ScheduleJob, field: EditableField) => ({
    enabled: isAdmin,
    editing: editingCell?.jobId === job.id && editingCell.field === field,
    onStart: () => setEditingCell({ jobId: job.id, field }),
    onStop: () => setEditingCell((c) => (c?.jobId === job.id && c.field === field ? null : c)),
    hint: t("doubleClickToEdit"),
  })

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
  // Full-screen search: case-insensitive, matching any word typed against the
  // job's customer (name, account / order numbers), type, address, notes,
  // remarks, filters and technicians. Everything below the search — the
  // sections, their counts, select-all and Complete All Pending — works off
  // this filtered list (after the status filter too), so a batch only ever
  // covers jobs that are visible.
  const customerById = React.useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const searchedJobs = React.useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return todaysJobs
    return todaysJobs.filter((job) => {
      const customer = job.customerId ? customerById.get(job.customerId) : undefined
      const haystack = [
        customer?.companyName,
        customer?.fullName,
        customer?.memberAccountNumber,
        customer?.orderNumber,
        customer?.address,
        job.orderNo,
        job.id,
        job.jobType,
        t(job.jobType),
        JOB_TYPE_LABELS[job.jobType],
        job.secondaryAddress,
        job.notes,
        job.remarks,
        job.filterCodes,
        job.technician,
        job.technician2,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [search, todaysJobs, customerById, t])
  // Per-tab counts follow the search; "All" also covers cancelled jobs.
  const statusCounts = React.useMemo(
    () => ({
      all: searchedJobs.length,
      pending: searchedJobs.filter((j) => j.status === "pending").length,
      completed: searchedJobs.filter((j) => j.status === "completed").length,
    }),
    [searchedJobs]
  )
  const visibleJobs = React.useMemo(
    () => (statusFilter === "all" ? searchedJobs : searchedJobs.filter((j) => j.status === statusFilter)),
    [searchedJobs, statusFilter]
  )

  const fullScreenSections = React.useMemo(() => {
    const byTechnician = new Map<string, typeof todaysJobs>()
    const unassigned: typeof todaysJobs = []
    for (const job of visibleJobs) {
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
  }, [visibleJobs])

  const gridClass = "grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]"
  const selectMode = isAdmin
  const pendingInView = React.useMemo(() => visibleJobs.filter((j) => j.status === "pending"), [visibleJobs])
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
  // The visible selected jobs if any, else every visible pending job — a
  // selection the search is currently hiding is never acted on.
  const visibleSelected = pendingInView.filter((j) => selected.has(j.id))
  const completionTargets = visibleSelected.length > 0 ? visibleSelected : pendingInView

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

  // Table View: the print layout's columns and blue header, one row per job
  // in the same order and with the same filters as the grid. Admins get a
  // selection column (pending rows only) feeding the same batch Mark as
  // Completed; clicking a row opens the job, as a card does.
  const jobTable = () => (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm" data-testid="schedule-job-table">
        <thead>
          <tr className="bg-primary text-left text-primary-foreground">
            {selectMode && (
              <th className="w-10 px-3 py-2">
                {pendingInView.length > 0 && (
                  <Checkbox
                    checked={selectAllState(visibleJobs)}
                    onCheckedChange={() => toggleSelectAll(visibleJobs)}
                    aria-label={t("selectAllPending")}
                    className="border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                  />
                )}
              </th>
            )}
            {(["date", "jobType", "technician", "vehicle", "orderNo", "status", "notes", "remarks"] as const).map((key) => (
              <th key={key} className="px-3 py-2 font-medium whitespace-nowrap">
                {t(TABLE_COLUMN_LABEL[key])}
              </th>
            ))}
            {isAdmin && <th className="w-10 px-2 py-2" aria-label={tCommon("edit")} />}
          </tr>
        </thead>
        <tbody>
          {visibleJobs.map((job, i) => (
            <tr
              key={job.id}
              data-testid="schedule-table-row"
              className={cn("border-t align-top", i % 2 === 1 && "bg-muted/40")}
            >
              {selectMode && (
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={job.status === "completed" || selected.has(job.id)}
                    onCheckedChange={() => toggleSelected(job.id)}
                    disabled={job.status !== "pending"}
                    aria-label={t("selectJob")}
                    data-testid="schedule-select-job"
                  />
                </td>
              )}
              <EditableCell
                {...cellProps(job, "date")}
                className="whitespace-nowrap"
                display={
                  <>
                    {formatDate(job.scheduledDate)}
                    {job.scheduledTime && <div className="text-xs text-muted-foreground">{job.scheduledTime}</div>}
                  </>
                }
              >
                <div className="flex flex-col gap-1">
                  <InlineDateCell value={job.scheduledDate} onCommit={(next) => next && saveJob(job, { scheduledDate: next })} />
                  <InlineTextCell
                    value={job.scheduledTime}
                    placeholder={t("timePlaceholder")}
                    className="w-[136px]"
                    onCommit={(next) => saveJob(job, { scheduledTime: next.trim() })}
                  />
                </div>
              </EditableCell>
              <EditableCell {...cellProps(job, "jobType")} className="whitespace-nowrap" display={t(job.jobType)}>
                <CellSelect
                  value={job.jobType}
                  options={JOB_TYPES.map((type) => ({ value: type, label: t(type) }))}
                  onCommit={(jobType) => {
                    saveJob(job, { jobType })
                    setEditingCell(null)
                  }}
                />
              </EditableCell>
              <EditableCell
                {...cellProps(job, "technician")}
                display={isAssignedTechnician(job.technician) ? formatTechnicians(job.technician, job.technician2, t("and")) : t("unassigned")}
              >
                <InlineTechnicianPairCell
                  primary={job.technician}
                  secondary={job.technician2}
                  onCommit={(patch) => saveJob(job, technicianInput(patch.primary ?? job.technician, patch.secondary ?? job.technician2 ?? ""))}
                />
              </EditableCell>
              <EditableCell {...cellProps(job, "vehicle")} display={job.vehicle || "—"}>
                <InlineComboboxCell
                  value={job.vehicle}
                  options={VEHICLE_OPTIONS}
                  placeholder={t("selectVehicle")}
                  commitOnSelect
                  showAllOnExactMatch
                  onCommit={(next) => {
                    saveVehicle(job, next.trim())
                    setEditingCell(null)
                  }}
                />
              </EditableCell>
              <EditableCell {...cellProps(job, "orderNo")} className="whitespace-nowrap" display={job.orderNo || "—"}>
                <InlineTextCell value={job.orderNo} className="w-32" onCommit={(next) => saveJob(job, { orderNo: next.trim() })} />
              </EditableCell>
              <EditableCell {...cellProps(job, "status")} display={<PlanStatusBadge status={job.status} />}>
                <CellSelect
                  value={job.status}
                  options={(["pending", "completed", "cancelled", ...(job.status === "pending_approval" ? ["pending_approval" as const] : [])] as ScheduleJobStatus[]).map(
                    (status) => ({ value: status, label: tStatus(STATUS_LABEL_KEY[status]) })
                  )}
                  onCommit={(status) => {
                    saveStatus(job, status)
                    setEditingCell(null)
                  }}
                />
              </EditableCell>
              <EditableCell
                {...cellProps(job, "notes")}
                className="max-w-[28rem] whitespace-pre-line wrap-break-word"
                display={job.notes || "—"}
              >
                <InlineTextAreaCell value={job.notes} className="w-72" onCommit={(next) => saveJob(job, { notes: next })} />
              </EditableCell>
              <EditableCell
                {...cellProps(job, "remarks")}
                className="max-w-[20rem] whitespace-pre-line wrap-break-word"
                display={job.remarks || "—"}
              >
                <InlineTextAreaCell value={job.remarks} className="w-60" onCommit={(next) => saveJob(job, { remarks: next })} />
              </EditableCell>
              {isAdmin && (
                <td className="px-2 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={t("editJob")}
                    title={t("editJob")}
                    data-testid="schedule-edit-job"
                    onClick={() => openEdit(job)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const fullScreenJobs = () => {
    if (isPending || todaysJobs.length === 0) return jobList()
    if (visibleJobs.length === 0) {
      return (
        <p data-testid="schedule-no-matches" className="py-16 text-center text-sm text-muted-foreground">
          {t("noMatchingJobs")}
        </p>
      )
    }
    if (viewMode === "table") return jobTable()
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
          if (!open) {
            setSelected(new Set())
            setSearch("")
            setStatusFilter("pending")
          }
        }}
      >
        <DialogContent
          className="inset-0 top-0 left-0 flex h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
        >
          <DialogHeader className="flex flex-col gap-2 border-b p-4 pr-12 sm:flex-row sm:items-center sm:justify-between">
            <DialogTitle className="flex shrink-0 items-center gap-2 text-base whitespace-nowrap">
              <CalendarClock className="h-4 w-4 text-primary" /> {title}
              <span className="text-sm font-normal text-muted-foreground">· {formatDate(date)}</span>
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label={t("viewMode")} className="inline-flex rounded-md border p-0.5" data-testid="schedule-view-mode">
                {(["grid", "table"] as ViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={viewMode === mode}
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
                      viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {mode === "grid" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Rows3 className="h-3.5 w-3.5" />}
                    {t(mode === "grid" ? "gridView" : "tableView")}
                  </button>
                ))}
              </div>
              <div role="group" aria-label={t("statusFilter")} className="inline-flex rounded-md border p-0.5" data-testid="schedule-status-filter">
                {(["all", "pending", "completed"] as StatusFilter[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                    className={cn(
                      "h-7 rounded px-2.5 text-xs font-medium transition-colors",
                      statusFilter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {t(STATUS_FILTER_LABEL[value])} ({statusCounts[value]})
                  </button>
                ))}
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("fullScreenSearchPlaceholder")}
                  aria-label={t("fullScreenSearchPlaceholder")}
                  className="h-8 pr-8 pl-8 text-sm"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label={t("clearSearch")}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {selectMode && pendingInView.length > 0 && (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selectAllState(visibleJobs)} onCheckedChange={() => toggleSelectAll(visibleJobs)} aria-label={t("selectAllPending")} />
                    {t("selectAllPending")}
                  </label>
                  <Button size="sm" className="gap-1.5" disabled={completeJobs.isPending} onClick={() => setConfirmComplete(true)}>
                    <CheckCheck className="h-3.5 w-3.5" />
                    {visibleSelected.length > 0
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
