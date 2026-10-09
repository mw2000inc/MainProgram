"use client"

import * as React from "react"
import Link from "next/link"
import { isOverdueJob, OVERDUE_SCHEDULE_HREF } from "@/lib/scheduling/overdue"
import { businessToday } from "@/lib/dispatch-lead-time"
import { CalendarClock, CalendarRange, CheckCheck, History, LayoutGrid, Loader2, Pencil, Plus, ArrowRight, Printer, Rows3, Search, Send, Trash2, X } from "lucide-react"
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
import { ScheduleFormDialog, type ScheduleJobPrefill } from "@/components/schedule/schedule-form-dialog"
import { buildUnscheduledVisits, type UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import { linkVisitToScheduleJob } from "@/lib/api/schedule"
import { useQueryClient } from "@tanstack/react-query"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { toast } from "sonner"
import { useDragHandle } from "@/components/dashboard/sortable-panel"
import { JOB_TYPE_LABELS, SCHEDULE_EXPORT_COLUMNS, formatTechnicians, computeStopNumbers } from "@/components/schedule/schedule-columns"
import { scheduleJobsKey, useCompleteScheduleJobs, useScheduleJobs, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useCreateScheduleJobFilterItems } from "@/lib/hooks/use-schedule-job-filter-items"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useAuth } from "@/lib/auth/auth-context"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { printTable } from "@/lib/export/print"
import { cn, formatDate, todayIso } from "@/lib/utils"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { assignmentAccounts, crewForVehicle, crewOfTechnician, isAssignedTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { InlineComboboxCell, InlineDateCell, InlineTextAreaCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { JobInventoryCell } from "@/components/schedule/job-inventory-cell"
import { ScheduleHistoryDialog } from "@/components/schedule/schedule-history-dialog"
import { VisitDispatchReview, type VisitDraft } from "@/components/schedule/visit-dispatch-review"
import { SaturdayRedistributeDialog } from "@/components/schedule/saturday-redistribute-dialog"
import { SaturdayCoverageDialog } from "@/components/schedule/saturday-coverage-dialog"
import { updateScheduleJob } from "@/lib/api/schedule"
import { triggerAutomation } from "@/lib/api/automations"
import { createJobsFromVisits } from "@/lib/scheduling/create-jobs-from-visits"
import { createDispatchAssigner } from "@/lib/scheduling/dispatch-assignment"
import {
  dispatchDateFor,
  isSaturday,
  saturdaysInRange,
} from "@/lib/schedule-timeframe"
import { formatScheduleRange } from "@/components/schedule/schedule-date-range-picker"
import { StockMovementHistoryDialog } from "@/components/dashboard/stock-movement-history-dialog"
import { StockMovementApprovalQueue } from "@/components/dashboard/stock-movement-approval-queue"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useStockMovementRows, type StockMovementRow } from "@/lib/hooks/use-inventory"
import { useUsers } from "@/lib/hooks/use-misc"
import { VEHICLE_TYPES } from "@/lib/constants"
import type { ScheduleJob, ScheduleJobSource, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

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
const CARD_STATUS_KEY = "schedule-card-status"
const TABLE_COLUMN_LABEL = {
  date: "tableDate",
  jobType: "tableJobType",
  technician: "tableTechnician",
  vehicle: "tableVehicle",
  orderNo: "tableOrderNo",
  status: "tableStatus",
  inventory: "tableInventory",
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

// Badge text / tooltip keys for jobs the system created (job.source).
const SOURCE_BADGE: Record<Exclude<ScheduleJobSource, "manual">, { label: string; hint: string }> = {
  automation: { label: "sourceAutomation", hint: "sourceAutomationHint" },
  auto_suggest: { label: "sourceAutoSuggest", hint: "sourceAutoSuggestHint" },
  customer_confirmed: { label: "sourceCustomerConfirmed", hint: "sourceCustomerConfirmedHint" },
}

// "Auto" / "Auto-suggest" / "Customer confirmed" next to a job's type; nothing
// for a job an admin added by hand.
// "Rescheduled from Sat, Oct 10" — moved off a cancelled Saturday by
// "Cancel & Auto-Distribute Saturday Queue".
function RescheduledBadge({ date, t }: { date: string; t: (key: string, params?: Record<string, string>) => string }) {
  return (
    <Badge
      variant="outline"
      data-testid="schedule-rescheduled-badge"
      className="h-5 border-primary/30 bg-primary/5 px-1.5 text-[10px] font-semibold text-primary"
    >
      {t("rescheduledFromSaturday", { date: formatDate(date) })}
    </Badge>
  )
}

// An auto-generated job still awaiting an admin's review (the draft job
// automation and the filter-change automation create these).
// Step 3 of the dispatch pipeline: a job awaiting final admin approval —
// drafted by the automation or created by a customer's confirmation.
// The fields an approval may save along with it.
type JobPatch = Partial<Omit<ScheduleJob, "id" | "createdAt">>

const isDraftJob = (job: Pick<ScheduleJob, "status" | "source">) =>
  job.status === "pending_approval" && (job.source === "automation" || job.source === "customer_confirmed")

// "Draft · Auto-assigned (pending review)".
function DraftBadge({ t }: { t: (key: string) => string }) {
  return (
    <Badge
      variant="outline"
      data-testid="schedule-draft-badge"
      title={t("draftBadgeHint")}
      className="h-5 border-warning/50 bg-warning/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning"
    >
      {t("draftBadge")}
    </Badge>
  )
}

// "Requires Technician Selection" — a Saturday job / visit nobody is
// assigned to yet (Saturday is never auto-assigned).
function NeedsTechnicianBadge({ t }: { t: (key: string) => string }) {
  return (
    <Badge
      variant="outline"
      data-testid="schedule-needs-technician-badge"
      title={t("needsTechnicianHint")}
      className="h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive"
    >
      {t("needsTechnician")}
    </Badge>
  )
}

// Still to do: active, or a Saturday job awaiting coverage approval.
const isOpenStatus = (status: ScheduleJobStatus) => status === "pending" || status === "pending_approval"

// An errand: a non-visit task (job type "other" — stock pickup, a payment
// collection, an audit), its description in notes.
const isErrand = (job: Pick<ScheduleJob, "jobType">) => job.jobType === "other"
const jobLabel = (job: Pick<ScheduleJob, "jobType" | "notes">, t: (key: string) => string) =>
  isErrand(job) && job.notes?.trim() ? job.notes.trim() : t(job.jobType)

function ErrandBadge({ t }: { t: (key: string) => string }) {
  return (
    <Badge
      variant="outline"
      data-testid="schedule-errand-badge"
      className="h-5 border-violet-500/40 bg-violet-500/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300"
    >
      {t("errandBadge")}
    </Badge>
  )
}

function JobSourceBadge({ source, t }: { source: ScheduleJobSource; t: (key: string) => string }) {
  if (source === "manual") return null
  const badge = SOURCE_BADGE[source]
  return (
    <Badge
      variant="outline"
      data-testid="schedule-job-source-badge"
      title={t(badge.hint)}
      className="h-5 border-primary/30 bg-primary/5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
    >
      {t(badge.label)}
    </Badge>
  )
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
  // Full-screen search (cleared when the view closes).
  const [search, setSearch] = React.useState("")
  // Full-screen status filter — Pending by default, so the grid shows the
  // jobs still to do (reset to it whenever the view closes).
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("pending")
  // The widget card's own All / Pending / Completed toggle (the full-screen
  // view has its tabs above) — remembered per browser, All by default.
  const [cardStatus, setCardStatusState] = React.useState<StatusFilter>(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(CARD_STATUS_KEY) : null
      return saved === "pending" || saved === "completed" ? saved : "all"
    } catch {
      return "all"
    }
  })
  const setCardStatus = (value: StatusFilter) => {
    setCardStatusState(value)
    try {
      window.localStorage.setItem(CARD_STATUS_KEY, value)
    } catch {
      // ignore — the choice just won't be remembered
    }
  }
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
  // The Daily Report's own date — this panel shows that one day only, like
  // every other panel on the report (no separate range of its own; the
  // Full Schedule page keeps ranges). Changing the report date changes it.
  const range = React.useMemo(() => ({ start: date, end: date }), [date])
  const multiDay = range.start !== range.end
  const rangeLabel = formatScheduleRange(range)
  const [historyOpen, setHistoryOpen] = React.useState(false)
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
  // Each job's stock movements (queued or used items and their approvals),
  // for the Table View's Inventory / Approved By column.
  const { data: stockMovementRows = [] } = useStockMovementRows()
  const movementsByJob = React.useMemo(() => {
    const map = new Map<string, StockMovementRow[]>()
    for (const m of stockMovementRows) {
      if (!m.relatedScheduleJobId) continue
      const list = map.get(m.relatedScheduleJobId) ?? []
      list.push(m)
      map.set(m.relatedScheduleJobId, list)
    }
    return map
  }, [stockMovementRows])
  // The job whose full Inventory History is open (clicked in that column),
  // and the review queue it can hand an unmapped item to.
  const [inventoryJob, setInventoryJob] = React.useState<ScheduleJob | undefined>(undefined)
  const [inventoryQueueOpen, setInventoryQueueOpen] = React.useState(false)
  // Link from that history to the job's own Filter Change / install / repair
  // / collection record (each page opens a record from ?id=).
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: collectionRecords = [] } = useCollections()
  // A Collection job's payment details, read live from its linked collection.
  const collectionByJobId = React.useMemo(
    () => new Map(collectionRecords.filter((c) => c.scheduleJobId).map((c) => [c.scheduleJobId as string, c])),
    [collectionRecords]
  )
  const paymentLine = (job: ScheduleJob) => {
    if (job.jobType !== "collection") return null
    const c = collectionByJobId.get(job.id)
    if (!c) return null
    const collected = c.collected || c.status === "Collected"
    return (
      <span data-testid="schedule-payment" className={cn("text-xs", collected ? "text-success" : "text-muted-foreground")}>
        {[c.amount ? `₱${c.amount.toLocaleString()}` : "", c.ct, collected ? t("paymentCollected") : t("paymentDue")].filter(Boolean).join(" · ")}
      </span>
    )
  }
  const recordHrefFor = (job: ScheduleJob): string | undefined => {
    const find = (rows: { id: string; scheduleJobId?: string }[], path: string) => {
      const record = rows.find((r) => r.scheduleJobId === job.id)
      return record ? `${path}?id=${record.id}` : undefined
    }
    if (job.jobType === "filter_change") return find(filterChangePlans, "/filter-change")
    if (job.jobType === "installation") return find(installPlans, "/install")
    if (job.jobType === "repair") return find(repairPlans, "/repair-plan")
    if (job.jobType === "collection") return find(collectionRecords, "/collection-plan")
    return undefined
  }
  // Unscheduled Visits (admins): Confirmed module visits in the timeframe
  // that no job covers yet, each schedulable with "Create Job".
  const qc = useQueryClient()
  const unscheduledVisits = React.useMemo(
    () =>
      isAdmin
        ? buildUnscheduledVisits({ filterChangePlans, installPlans, repairPlans, collections: collectionRecords, customers }, range).sort(
            (a, b) => a.date.localeCompare(b.date) || a.jobType.localeCompare(b.jobType) || a.name.localeCompare(b.name)
          )
        : [],
    [isAdmin, filterChangePlans, installPlans, repairPlans, collectionRecords, customers, range]
  )
  const [visitToSchedule, setVisitToSchedule] = React.useState<UnscheduledVisit | undefined>(undefined)
  // The date a visit's job goes on by default: one due on a Friday on
  // Saturday, otherwise its own date.
  const visitDispatchDate = React.useCallback((v: UnscheduledVisit) => dispatchDateFor(v.date), [])
  // Bulk Create Jobs: which visits are ticked, and the dialog.
  const [selectedVisitKeys, setSelectedVisitKeys] = React.useState<Set<string>>(new Set())
  // Approve All & Dispatch: progress while it runs (null when idle).
  const [dispatching, setDispatching] = React.useState<{ done: number; total: number } | null>(null)
  // Edits an admin makes inline on a ticked Unscheduled Visit (date,
  // technician, vehicle, details) — held here, never saved on their own;
  // they pre-fill "Create Job" and the Bulk Create / Approve All & Dispatch
  // review, and are dropped once that visit's job is created.
  const [visitEdits, setVisitEdits] = React.useState<Record<string, Partial<Pick<VisitDraft, "date" | "primary" | "secondary" | "vehicle" | "detail">>>>({})
  const editVisit = (visit: UnscheduledVisit, patch: Partial<Pick<VisitDraft, "date" | "primary" | "secondary" | "vehicle" | "detail">>) =>
    setVisitEdits((e) => ({ ...e, [visit.key]: { ...e[visit.key], ...patch } }))
  const dropVisitEdits = (keys: string[]) =>
    setVisitEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))))
  const visitPrefill = React.useMemo<ScheduleJobPrefill | undefined>(() => {
    if (!visitToSchedule) return undefined
    const edit = visitEdits[visitToSchedule.key] ?? {}
    const scheduledDate = edit.date ?? visitDispatchDate(visitToSchedule)
    return {
      jobType: visitToSchedule.jobType,
      scheduledDate,
      orderNo: visitToSchedule.orderNo,
      customerId: visitToSchedule.customerId,
      // Saturday is never pre-filled — the admin picks who's working —
      // unless they already picked someone inline.
      technician: edit.primary !== undefined ? edit.primary : isSaturday(scheduledDate) ? undefined : visitToSchedule.technician,
      technician2: edit.primary !== undefined ? edit.secondary : isSaturday(scheduledDate) ? undefined : visitToSchedule.technician2,
      vehicle: edit.vehicle,
      secondaryAddress: visitToSchedule.address,
      notes: [visitToSchedule.name, edit.detail ?? visitToSchedule.detail].filter(Boolean).join(" — "),
      filterCodes: visitToSchedule.filterCodes,
    }
  }, [visitToSchedule, visitDispatchDate, visitEdits])
  // The new job takes over the visit (the database's own sync would usually
  // link it too; this makes sure it's exactly this visit).
  const linkScheduledVisit = async (visit: UnscheduledVisit, job: ScheduleJob) => {
    try {
      await linkVisitToScheduleJob(visit.table, visit.recordId, job.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    const key = { filter_change_plans: filterChangePlansKey, install_plans: installPlansKey, repair_plans: repairPlansKey, collections: collectionsKey }[visit.table]
    qc.invalidateQueries({ queryKey: key })
  }
  const { data: users = [] } = useUsers()
  // Technician logins, plus the fixed crews' members whatever their role (see assignmentAccounts).
  const technicianAccounts = React.useMemo(() => assignmentAccounts(users), [users])
  const [editingCell, setEditingCell] = React.useState<{ jobId: string; field: EditableField } | null>(null)
  const saveJob = (job: ScheduleJob, input: Partial<Omit<ScheduleJob, "id" | "createdAt">>) => updateJob.mutate({ id: job.id, input })
  // A technician change also re-links the technicians' logins by name, so the
  // job shows in the right technician's own Daily Report (never the
  // previous technician's).
  const technicianInput = (primary: string, secondary: string) => {
    const pair = normalizeTechnicianPair(primary, secondary)
    return { technician: pair.primary, technician2: pair.secondary, ...technicianAccountIds(pair.primary, pair.secondary, technicianAccounts) }
  }
  // Saturday is assigned by hand only: moving a job onto a Saturday clears
  // its technicians and vehicle and holds it for an admin; picking a
  // technician for a held Saturday job (explicitly, here) makes it active.
  const dateChange = (job: ScheduleJob, scheduledDate: string): Partial<ScheduleJob> =>
    isSaturday(scheduledDate) && !isSaturday(job.scheduledDate)
      ? {
          scheduledDate,
          technician: "",
          technician2: "",
          technicianUserId: "",
          technician2UserId: "",
          vehicle: "",
          ...(job.status === "pending" ? { status: "pending_approval" as const } : {}),
        }
      : { scheduledDate }
  const technicianChange = (job: ScheduleJob, primary: string, secondary: string): Partial<ScheduleJob> => {
    const input = technicianInput(primary, secondary)
    return isSaturday(job.scheduledDate) && job.status === "pending_approval" && isAssignedTechnician(input.technician)
      ? { ...input, status: "pending" }
      : input
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
    // Exactly the jobs dated the report date, in every status (draft,
    // awaiting approval, pending, completed, cancelled) — nothing carried in
    // from another day. Unfinished work from earlier days stays on the Full
    // Schedule. A technician never receives a job awaiting approval (RLS
    // hides 'pending_approval'), so for them it's their own jobs that day.
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
        j.scheduledDate >= range.start &&
        j.scheduledDate <= range.end &&
        (isAdmin || j.technicianUserId === user?.id || j.technician2UserId === user?.id)
    )
    // Day first (a multi-day timeframe), then technician and route order.
    return [...filtered].sort((a, b) => {
      if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate)
      if (a.technician !== b.technician) return a.technician.localeCompare(b.technician)
      if (a.routeSequence == null && b.routeSequence == null) return 0
      if (a.routeSequence == null) return 1
      if (b.routeSequence == null) return -1
      return a.routeSequence - b.routeSequence
    })
  }, [jobs, range, isAdmin, user?.id])

  // Display-only "Stop 1, Stop 2, ..." per technician for this one day —
  // same computation the Schedule page's List view uses (see
  // computeStopNumbers' own comment on why it's shared), so the two can
  // never disagree about which stop number a given job shows.
  const stopNumberByJobId = React.useMemo(() => computeStopNumbers(todaysJobs), [todaysJobs])

  // Technician group boundaries within todaysJobs' own sort order above —
  // just the index of each first-of-a-technician row, so the list below can
  // drop a "TECHNICIAN" header exactly there without a second data
  // structure duplicating todaysJobs itself.
  // What the card lists: the timeframe's jobs, narrowed by its status toggle.
  const cardJobs = React.useMemo(
    () =>
      cardStatus === "all"
        ? todaysJobs
        : todaysJobs.filter((j) => (cardStatus === "pending" ? isOpenStatus(j.status) : j.status === cardStatus)),
    [todaysJobs, cardStatus]
  )
  const cardCounts = React.useMemo(
    () => ({
      all: todaysJobs.length,
      pending: todaysJobs.filter((j) => isOpenStatus(j.status)).length,
      completed: todaysJobs.filter((j) => j.status === "completed").length,
    }),
    [todaysJobs]
  )
  const technicianHeaderAt = React.useMemo(() => {
    const set = new Set<number>()
    let last: string | undefined
    cardJobs.forEach((job, i) => {
      // A new day starts a new group too (multi-day timeframes).
      const key = `${job.scheduledDate}|${job.technician}`
      if (key !== last) set.add(i)
      last = key
    })
    return set
  }, [cardJobs])

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
    const groups: { key: string; technician: string; date: string; jobs: typeof todaysJobs }[] = []
    cardJobs.forEach((job, i) => {
      if (technicianHeaderAt.has(i) || groups.length === 0) groups.push({ key: `${job.technician}-${i}`, technician: job.technician, date: job.scheduledDate, jobs: [] })
      groups[groups.length - 1].jobs.push(job)
    })
    return groups
  }, [cardJobs, technicianHeaderAt])

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
          {isErrand(job) && <ErrandBadge t={t} />}
          <span className="font-medium">{jobLabel(job, t)}</span>
          <JobSourceBadge source={job.source} t={t} />
          {isDraftJob(job) && <DraftBadge t={t} />}
          {needsTechnician(job) && <NeedsTechnicianBadge t={t} />}
          {paymentLine(job)}
          {job.rescheduledFrom && <RescheduledBadge date={job.rescheduledFrom} t={t} />}
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
        {/* An errand's notes are its description, already shown as its label. */}
        {job.notes && !isErrand(job) && <p className="text-xs wrap-break-word">{job.notes}</p>}
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
        // So "auto" / "customer" finds the system-created jobs too.
        job.source !== "manual" ? t(SOURCE_BADGE[job.source].label) : undefined,
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
      pending: searchedJobs.filter((j) => isOpenStatus(j.status)).length,
      completed: searchedJobs.filter((j) => j.status === "completed").length,
    }),
    [searchedJobs]
  )
  const visibleJobs = React.useMemo(
    () =>
      statusFilter === "all"
        ? searchedJobs
        : searchedJobs.filter((j) => (statusFilter === "pending" ? isOpenStatus(j.status) : j.status === statusFilter)),
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
            {(["date", "jobType", "technician", "vehicle", "orderNo", "status", "inventory", "notes", "remarks"] as const).map((key) => (
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
                  <InlineDateCell value={job.scheduledDate} onCommit={(next) => next && saveJob(job, dateChange(job, next))} />
                  <InlineTextCell
                    value={job.scheduledTime}
                    placeholder={t("timePlaceholder")}
                    className="w-[136px]"
                    onCommit={(next) => saveJob(job, { scheduledTime: next.trim() })}
                  />
                </div>
              </EditableCell>
              <EditableCell
                {...cellProps(job, "jobType")}
                className="whitespace-nowrap"
                display={
                  <span className="inline-flex items-center gap-1.5">
                    {isErrand(job) && <ErrandBadge t={t} />}
                    {jobLabel(job, t)}
                    <JobSourceBadge source={job.source} t={t} />
                    {isDraftJob(job) && <DraftBadge t={t} />}
                    {needsTechnician(job) && <NeedsTechnicianBadge t={t} />}
                    {paymentLine(job)}
                    {job.rescheduledFrom && <RescheduledBadge date={job.rescheduledFrom} t={t} />}
                  </span>
                }
              >
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
                  onCommit={(patch) => saveJob(job, technicianChange(job, patch.primary ?? job.technician, patch.secondary ?? job.technician2 ?? ""))}
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
              <td className="px-3 py-2" data-testid="schedule-inventory-cell">
                <JobInventoryCell movements={movementsByJob.get(job.id) ?? []} onOpen={() => setInventoryJob(job)} />
              </td>
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

  // Search narrows the visits too; they're all pending, so the Completed
  // tab hides them.
  const visibleVisits = React.useMemo(() => {
    if (statusFilter === "completed") return []
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return unscheduledVisits
    return unscheduledVisits.filter((v) => {
      const haystack = [v.name, v.orderNo, v.address, v.detail, v.technician, v.technician2, t(v.jobType)].filter(Boolean).join(" ").toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [unscheduledVisits, statusFilter, search, t])

  // Only visits still on screen count as selected (search / timeframe can
  // hide ticked ones).
  const selectedVisits = visibleVisits.filter((v) => selectedVisitKeys.has(v.key))
  const allVisitsSelected = visibleVisits.length > 0 && selectedVisits.length === visibleVisits.length
  const toggleVisit = (key: string) =>
    setSelectedVisitKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleAllVisits = () => setSelectedVisitKeys(allVisitsSelected ? new Set() : new Set(visibleVisits.map((v) => v.key)))
  // Bulk Create (ticked visits) and Approve All & Dispatch (every visit on
  // screen) both open VisitDispatchReview: each visit as the job it will
  // become, editable, created only on confirm. The proposal is the admin's
  // held inline edits, else — for Bulk Create — the visit's planned
  // technician (none on a Saturday), or — for Approve All & Dispatch — the
  // automatic assignment (createDispatchAssigner: planned → Liteace for
  // installs → same place → customer's → nearby → least busy; Saturdays
  // unassigned). Each job is dated its visit's dispatch date (Friday visits on
  // Saturday) unless changed.
  const [visitReview, setVisitReview] = React.useState<{ mode: "bulk" | "dispatch"; visits: UnscheduledVisit[]; proposals: Record<string, VisitDraft> } | null>(null)
  const openVisitReview = (mode: "bulk" | "dispatch", targets: UnscheduledVisit[]) => {
    if (targets.length === 0 || dispatching) return
    const assigner = mode === "dispatch" ? createDispatchAssigner({ jobs, customers, accounts: assignmentAccounts(users) }) : undefined
    const proposals: Record<string, VisitDraft> = {}
    for (const v of targets) {
      const edit = visitEdits[v.key] ?? {}
      const date = edit.date ?? visitDispatchDate(v)
      let pair = { primary: "", secondary: "" }
      let vehicle = ""
      let technicianChosen = false
      if (edit.primary !== undefined) {
        pair = normalizeTechnicianPair(edit.primary, edit.secondary ?? "")
        technicianChosen = isAssignedTechnician(pair.primary)
      } else if (assigner) {
        const a = assigner({ ...v, detail: edit.detail ?? v.detail }, date)
        pair = a.pair
        vehicle = a.vehicle
      } else if (!isSaturday(date)) {
        pair = normalizeTechnicianPair(v.technician, v.technician2)
      }
      const crew = crewOfTechnician(pair.primary)
      proposals[v.key] = {
        date,
        primary: pair.primary,
        secondary: pair.secondary,
        vehicle: edit.vehicle ?? (vehicle || crew?.vehicle || ""),
        detail: edit.detail ?? v.detail ?? "",
        remarks: "",
        technicianChosen,
      }
    }
    setVisitReview({ mode, visits: targets, proposals })
  }
  const createFromReview = async (items: { visit: UnscheduledVisit; draft: VisitDraft }[]) => {
    const byKey = new Map(items.map((i) => [i.visit.key, i]))
    const accounts = assignmentAccounts(users)
    setDispatching({ done: 0, total: items.length })
    const { created, failed, awaitingApproval } = await createJobsFromVisits(
      items.map(({ visit, draft }) => ({ ...visit, detail: draft.detail || undefined })),
      {
        dateFor: (v) => byKey.get(v.key)!.draft.date,
        createDateFor: (v) => visitDispatchDate(byKey.get(v.key)!.visit),
        assignFor: (v) => {
          const d = byKey.get(v.key)!.draft
          return { pair: { primary: d.primary, secondary: d.secondary }, vehicle: d.vehicle }
        },
        activateFor: (v) => {
          const d = byKey.get(v.key)!.draft
          return d.technicianChosen && isAssignedTechnician(d.primary)
        },
        remarksFor: (v) => byKey.get(v.key)!.draft.remarks,
        accounts,
        onProgress: (done) => setDispatching((p) => (p ? { ...p, done } : p)),
      }
    )
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setDispatching(null)
    setSelectedVisitKeys(new Set())
    dropVisitEdits(items.map((i) => i.visit.key))
    if (created) toast.success(t("dispatchAllDone", { count: created }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
    if (awaitingApproval) toast.warning(t("saturdayJobsAwaiting", { count: awaitingApproval }))
  }

  const visitCheckbox = (v: UnscheduledVisit) => (
    <Checkbox checked={selectedVisitKeys.has(v.key)} onCheckedChange={() => toggleVisit(v.key)} aria-label={t("selectVisit")} data-testid="unscheduled-select" />
  )

  const createJobButton = (visit: UnscheduledVisit) => (
    <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" data-testid="unscheduled-create-job" onClick={() => setVisitToSchedule(visit)}>
      <Plus className="h-3.5 w-3.5" /> {t("createJob")}
    </Button>
  )
  const unscheduledSection = () =>
    visibleVisits.length === 0 ? null : (
      <section data-testid="unscheduled-visits" className="mt-6 rounded-md border border-dashed border-warning/50 bg-warning/5 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Checkbox
            checked={allVisitsSelected ? true : selectedVisits.length > 0 ? "indeterminate" : false}
            onCheckedChange={toggleAllVisits}
            aria-label={t("selectAllVisits")}
            data-testid="unscheduled-select-all"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("unscheduledVisits")}</span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-semibold">
            {visibleVisits.length}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1.5 text-xs"
            disabled={selectedVisits.length === 0 || !!dispatching}
            onClick={() => openVisitReview("bulk", selectedVisits)}
            data-testid="unscheduled-bulk-create"
          >
            <CheckCheck className="h-3.5 w-3.5" /> {t("bulkCreateJobs", { count: selectedVisits.length })}
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={visibleVisits.length === 0 || !!dispatching}
            onClick={() => openVisitReview("dispatch", visibleVisits)}
            title={t("dispatchAllHint")}
            data-testid="unscheduled-dispatch-all"
          >
            {dispatching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("dispatchAllProgress", { done: dispatching.done, total: dispatching.total })}
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" /> {t("dispatchAll", { count: visibleVisits.length })}
              </>
            )}
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{t("unscheduledVisitsHint")}</p>
        {viewMode === "table" ? (
          <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full text-sm" data-testid="unscheduled-table">
              <thead>
                <tr className="bg-muted text-left text-xs text-muted-foreground">
                  <th className="w-10 px-3 py-2" />
                  {(["tableDate", "tableJobType", "tableCustomerOrder", "tableAddress", "tablePlannedTechnician", "tableVehicle", "tableDetails"] as const).map((key) => (
                    <th key={key} className="px-3 py-2 font-medium whitespace-nowrap">
                      {t(key)}
                    </th>
                  ))}
                  <th className="w-28 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleVisits.map((v) => {
                  // A ticked row is edited in place; the edits are held (see
                  // visitEdits) until a job is created from it.
                  const editing = isAdmin && selectedVisitKeys.has(v.key)
                  const edit = visitEdits[v.key] ?? {}
                  const date = edit.date ?? visitDispatchDate(v)
                  const primary = edit.primary !== undefined ? edit.primary : v.technician
                  const secondary = edit.primary !== undefined ? (edit.secondary ?? "") : v.technician2
                  return (
                  <tr key={v.key} data-testid="unscheduled-row" data-editing={editing || undefined} className={cn("border-t align-top", editing && "bg-primary/5")}>
                    <td className="px-3 py-2">
                      {visitCheckbox(v)}
                      {visitEdits[v.key] && <div className="mt-1 text-[10px] font-medium text-primary">{t("monthReviewEditedBadge")}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {editing ? (
                        <InlineDateCell
                          value={date}
                          onCommit={(next) =>
                            next &&
                            editVisit(v, isSaturday(next) && !isSaturday(date) ? { date: next, primary: "", secondary: "", vehicle: "" } : { date: next })
                          }
                        />
                      ) : (
                        formatDate(edit.date ?? v.date)
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {t(v.jobType)}
                      {v.rescheduledFrom && (
                        <div className="mt-1">
                          <RescheduledBadge date={v.rescheduledFrom} t={t} />
                        </div>
                      )}
                      {isSaturday(visitDispatchDate(v)) && (
                        <div className="mt-1">
                          <NeedsTechnicianBadge t={t} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-muted-foreground">{v.orderNo}</div>
                    </td>
                    <td className="max-w-[18rem] px-3 py-2 text-xs">{v.address || "—"}</td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <InlineTechnicianPairCell
                          primary={primary}
                          secondary={secondary}
                          onCommit={(p) => {
                            const pair = normalizeTechnicianPair(p.primary ?? primary, p.secondary ?? secondary ?? "")
                            editVisit(v, { primary: pair.primary, secondary: pair.secondary })
                          }}
                        />
                      ) : isAssignedTechnician(primary) ? (
                        formatTechnicians(primary, secondary || undefined, t("and"))
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editing ? (
                        <InlineComboboxCell
                          value={edit.vehicle ?? ""}
                          options={VEHICLE_OPTIONS}
                          placeholder={t("selectVehicle")}
                          commitOnSelect
                          showAllOnExactMatch
                          onCommit={(next) => {
                            const vehicle = next.trim()
                            const crew = crewForVehicle(vehicle)
                            editVisit(v, { vehicle, ...(crew ? { primary: crew.primary, secondary: crew.secondary } : {}) })
                          }}
                        />
                      ) : (
                        edit.vehicle || "—"
                      )}
                    </td>
                    <td className="max-w-[16rem] px-3 py-2 text-xs">
                      {editing ? (
                        <InlineTextAreaCell value={edit.detail ?? v.detail} className="w-56" onCommit={(next) => editVisit(v, { detail: next })} />
                      ) : (
                        (edit.detail ?? v.detail) || "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{createJobButton(v)}</td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={gridClass}>
            {visibleVisits.map((v) => (
              <div key={v.key} data-testid="unscheduled-tile" className="rounded-md border bg-background p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="pt-0.5">{visitCheckbox(v)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {t(v.jobType)} <span className="text-muted-foreground">· {v.orderNo}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDate(v.date)}
                      {v.rescheduledFrom && <RescheduledBadge date={v.rescheduledFrom} t={t} />}
                      {isSaturday(visitDispatchDate(v)) && <NeedsTechnicianBadge t={t} />}
                    </div>
                  </div>
                  {createJobButton(v)}
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs">
                  <div className="font-medium">{v.name}</div>
                  {v.address && <div className="text-muted-foreground">{v.address}</div>}
                  {v.detail && <div>{v.detail}</div>}
                  {isAssignedTechnician(v.technician) && <div className="text-muted-foreground">{formatTechnicians(v.technician, v.technician2, t("and"))}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    )

  // Saturday coverage: Saturday is never auto-assigned (technician
  // availability changes each Saturday). Its jobs wait, Unassigned, until an
  // admin ticks who's working ("Assign Saturday Coverage"); a Saturday's
  // queue can instead be cancelled and spread over Mon–Wed by area.
  const saturdays = React.useMemo(() => saturdaysInRange(range), [range])
  const singleSaturday = range.start === range.end && isSaturday(range.start) ? range.start : undefined
  const [redistributeOpen, setRedistributeOpen] = React.useState(false)
  const [coverageSaturday, setCoverageSaturday] = React.useState<string | undefined>(undefined)
  // A Saturday's open jobs and the unscheduled visits that would go on it.
  const saturdayJobsOn = (saturday: string) => todaysJobs.filter((j) => isOpenStatus(j.status) && j.scheduledDate === saturday)
  const saturdayVisitsOn = (saturday: string) => unscheduledVisits.filter((v) => visitDispatchDate(v) === saturday)
  const needsTechnician = (job: ScheduleJob) => isSaturday(job.scheduledDate) && isOpenStatus(job.status) && !isAssignedTechnician(job.technician)
  const awaitingSaturday = todaysJobs.filter((j) => isSaturday(j.scheduledDate) && (j.status === "pending_approval" || needsTechnician(j)))
  const saturdayQueueJobs = todaysJobs.filter((j) => isOpenStatus(j.status))

  // The report day's drafts: "Approve All for <date>" approves exactly these,
  // or ask the automation for more. (Saturday drafts are left to "Assign
  // Saturday Coverage".)
  // Unfinished jobs from earlier days (admins, when the report date is today
  // or later): only a count with a link to the Full Schedule's Overdue
  // filter — never mixed into this single-date list.
  const overdueCount = React.useMemo(() => {
    const today = businessToday()
    if (!isAdmin || date < today) return 0
    return jobs.filter((j) => isOverdueJob(j, today)).length
  }, [isAdmin, date, jobs])
  const draftJobs = todaysJobs.filter((j) => isDraftJob(j) && j.scheduledDate === date && !isSaturday(j.scheduledDate))
  const approveTargets = draftJobs
  const [approvingDrafts, setApprovingDrafts] = React.useState(false)
  const [generatingDrafts, setGeneratingDrafts] = React.useState(false)
  // Approves the drafts in view — or, from the month review, the given jobs
  // with the edits made there saved in the same write.
  const approveAllDrafts = async (items: { job: ScheduleJob; patch: JobPatch }[] = approveTargets.map((job) => ({ job, patch: {} }))) => {
    setApprovingDrafts(true)
    let approved = 0
    const failed: string[] = []
    for (const { job, patch } of items) {
      try {
        await updateScheduleJob(job.id, { ...patch, status: "pending" })
        approved += 1
      } catch (error) {
        failed.push(`${job.orderNo ?? job.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setApprovingDrafts(false)
    if (approved) toast.success(t("draftsApproved", { count: approved }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
  }
  const generateDrafts = async () => {
    setGeneratingDrafts(true)
    try {
      // Only the report day's visits: drafts whose job lands on this date.
      const result = await triggerAutomation("generateDraftJobs", { date })
      const drafted = Number((result.detail as { drafted?: number } | undefined)?.drafted ?? 0)
      if (result.ok) toast.success(t("draftsGenerated", { count: drafted }))
      else toast.error(result.message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setGeneratingDrafts(false)
  }
  const saturdayBanner = () =>
    !isAdmin || saturdays.length === 0 ? null : (
      <div data-testid="saturday-banner" className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
        <p className="font-medium text-warning">{t("saturdayBannerTitle")}</p>
        <p className="mt-0.5 text-muted-foreground">
          {awaitingSaturday.length > 0 ? t("saturdayBannerAwaiting", { count: awaitingSaturday.length }) : t("saturdayBannerNone")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {saturdays.map((saturday) => {
            const count = saturdayJobsOn(saturday).length + saturdayVisitsOn(saturday).length
            return (
              <Button
                key={saturday}
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setCoverageSaturday(saturday)}
                data-testid="saturday-coverage-open"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                {saturdays.length > 1 ? t("coverageOpenFor", { date: formatDate(saturday), count }) : t("coverageOpen", { count })}
              </Button>
            )
          })}
          {singleSaturday && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setRedistributeOpen(true)} data-testid="saturday-redistribute-open">
              <CalendarRange className="h-3.5 w-3.5" /> {t("redistributeOpen")}
            </Button>
          )}
        </div>
      </div>
    )

  const fullScreenJobs = () => (
    <>
      {saturdayBanner()}
      {scheduledJobsBody()}
      {unscheduledSection()}
    </>
  )

  const scheduledJobsBody = () => {
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
          {multiDay ? t("noJobsInTimeframe") : t("noJobsScheduled")}
        </p>
      )}
      {!isPending && !expanded && saturdayBanner()}
      {!isPending && overdueCount > 0 && !expanded && (
        <Link
          href={OVERDUE_SCHEDULE_HREF}
          data-testid="schedule-overdue-link"
          className="mb-3 flex w-full items-center justify-between rounded-md border border-dashed border-danger/40 bg-danger/5 px-3 py-2 text-left text-xs font-medium text-danger hover:bg-danger/10"
        >
          {t("overdueLink", { count: String(overdueCount) })}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
      {!isPending && unscheduledVisits.length > 0 && !expanded && (
        <button
          type="button"
          data-testid="unscheduled-visits-link"
          onClick={() => setExpanded(true)}
          className="mb-3 flex w-full items-center justify-between rounded-md border border-dashed border-warning/50 bg-warning/5 px-3 py-2 text-left text-xs font-medium hover:bg-warning/10"
        >
          {t("unscheduledVisitsCount", { count: unscheduledVisits.length })}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
      {!isPending && todaysJobs.length > 0 && (
        <div role="group" aria-label={t("statusFilter")} className="mb-3 inline-flex self-start rounded-md border p-0.5" data-testid="schedule-card-status">
          {(["all", "pending", "completed"] as StatusFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={cardStatus === value}
              onClick={() => setCardStatus(value)}
              className={cn(
                "h-6 rounded px-2 text-xs font-medium transition-colors",
                cardStatus === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {t(STATUS_FILTER_LABEL[value])} ({cardCounts[value]})
            </button>
          ))}
        </div>
      )}
      {!isPending && todaysJobs.length > 0 && cardJobs.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground" data-testid="schedule-card-status-empty">
          {t(cardStatus === "completed" ? "noCompletedJobsInView" : "noPendingJobsInView")}
        </p>
      )}
      {!isPending && cardJobs.length > 0 && (
        <div>
          {technicianGroups.map((group, g) => (
            <div key={group.key} className={cn(g > 0 && "pt-3")}>
              <div className="flex items-center gap-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.technician || t("unassigned")}
                {(multiDay || group.date !== date) && <span className="font-normal normal-case tracking-normal">· {formatDate(group.date)}</span>}
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
      {/* Always rendered (disabled at 0) so the toolbar never shifts. */}
      {isAdmin && (
        <Button
          size="sm"
          className="gap-1.5 bg-warning text-warning-foreground hover:bg-warning/90 @xs/card-header:flex-1 @sm/card-header:flex-none"
          disabled={approvingDrafts || approveTargets.length === 0}
          onClick={() => approveAllDrafts()}
          data-testid="drafts-approve-all"
        >
          {approvingDrafts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("draftsApproveDay", { date: formatDate(date, "MMM d"), count: draftJobs.length })}
        </Button>
      )}
      {isAdmin && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 @xs/card-header:flex-1 @sm/card-header:flex-none"
          disabled={generatingDrafts}
          onClick={generateDrafts}
          title={t("draftsGenerateHint")}
          data-testid="drafts-generate"
        >
          {generatingDrafts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
          {t("draftsGenerate")}
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
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            data-testid="schedule-history-button"
            onClick={() => setHistoryOpen(true)}
          >
            <History className="h-3.5 w-3.5" /> {t("history")}
          </Button>
        )}
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
              <span className="text-sm font-normal text-muted-foreground">· {rangeLabel}</span>
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

      {isAdmin && (
        <ScheduleHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          jobIdsInView={todaysJobs.map((j) => j.id)}
          rangeLabel={rangeLabel}
        />
      )}

      <StockMovementHistoryDialog
        open={!!inventoryJob}
        onOpenChange={(o) => !o && setInventoryJob(undefined)}
        job={inventoryJob ? { id: inventoryJob.id, orderNo: inventoryJob.orderNo, recordHref: recordHrefFor(inventoryJob) } : undefined}
        onMap={() => setInventoryQueueOpen(true)}
      />
      {isAdmin && <StockMovementApprovalQueue open={inventoryQueueOpen} onOpenChange={setInventoryQueueOpen} />}

      <ScheduleFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditingJob(undefined)
        }}
        defaultDate={date}
        job={editingJob}
      />
      {isAdmin && coverageSaturday && (
        <SaturdayCoverageDialog
          key={coverageSaturday}
          open={!!coverageSaturday}
          onOpenChange={(o) => !o && setCoverageSaturday(undefined)}
          saturday={coverageSaturday}
          jobs={saturdayJobsOn(coverageSaturday)}
          visits={saturdayVisitsOn(coverageSaturday)}
          accounts={technicianAccounts}
          addressOfJob={(job) => job.secondaryAddress || (job.customerId ? customerById.get(job.customerId)?.address : undefined)}
        />
      )}
      {isAdmin && singleSaturday && (
        <SaturdayRedistributeDialog
          key={redistributeOpen ? "open" : "closed"}
          open={redistributeOpen}
          onOpenChange={setRedistributeOpen}
          saturday={singleSaturday}
          jobs={saturdayQueueJobs}
          visits={unscheduledVisits}
          addressOfJob={(job) => job.secondaryAddress || (job.customerId ? customerById.get(job.customerId)?.address : undefined)}
        />
      )}
      {isAdmin && (
        <VisitDispatchReview
          open={!!visitReview}
          onOpenChange={(o) => !o && setVisitReview(null)}
          title={t(visitReview?.mode === "dispatch" ? "visitReviewTitleDispatch" : "visitReviewTitleBulk", { count: visitReview?.visits.length ?? 0 })}
          visits={visitReview?.visits ?? []}
          initial={(v) => visitReview!.proposals[v.key]}
          onConfirm={createFromReview}
        />
      )}
      <ScheduleFormDialog
        open={!!visitToSchedule}
        onOpenChange={(o) => !o && setVisitToSchedule(undefined)}
        defaultDate={visitToSchedule?.date ?? date}
        prefill={visitPrefill}
        onCreated={(job) => {
          if (!visitToSchedule) return
          linkScheduledVisit(visitToSchedule, job)
          dropVisitEdits([visitToSchedule.key])
        }}
      />
      <MarkJobDoneDialog key={markingDone?.id ?? "none"} job={markingDone} onOpenChange={(o) => !o && setMarkingDone(undefined)} />
    </Card>
  )
}
