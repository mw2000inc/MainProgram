"use client"

import * as React from "react"
import { Plus, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { InlineGridPickerCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import type { BulkSuggestionEntry, TechnicianSuggestion } from "@/components/shared/bulk-technician-suggest-dialog"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useTechnicianWorkloadIndex } from "@/lib/hooks/use-technician-workload"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import { cpSystemDueFiltersForDate } from "@/lib/cp-system-due-filters"
import { workloadFor, workloadPeriodLabels, type WorkloadCounts } from "@/lib/technician-workload"
import { getFilterPartOptions } from "@/lib/filter-parts"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { isAssignedTechnician } from "@/lib/technicians"
import type { ScheduleJobEdits, ScheduleNewJob } from "@/lib/api/schedule"
import type { ScheduleJob, ScheduleJobType } from "@/lib/types"

const JOB_TYPES: ScheduleJobType[] = ["filter_change", "collection", "repair", "installation", "monitoring", "other"]

// Quick picks for a repair's issue; anything else can be typed.
const REPAIR_ISSUES = ["Leaking fittings", "Low water pressure", "Motor/Pump replacement", "Unit inspection"]
const REPAIR_ISSUE_OPTIONS = REPAIR_ISSUES.map((value) => ({ value }))

// A repair's issue is kept as the first line of the job's notes
// ("Repair issue: Leaking fittings"), so the technician sees it on the Daily
// Report with no new column, and it's read back into its own field here.
const REPAIR_ISSUE_PREFIX = "Repair issue: "

function splitRepairIssue(notes: string): { repairIssue: string; notes: string } {
  const [first, ...rest] = notes.split("\n")
  if (!first.startsWith(REPAIR_ISSUE_PREFIX)) return { repairIssue: "", notes }
  return { repairIssue: first.slice(REPAIR_ISSUE_PREFIX.length).trim(), notes: rest.join("\n") }
}

function joinRepairIssue(jobType: ScheduleJobType, repairIssue: string, notes: string): string {
  const issue = jobType === "repair" ? repairIssue.trim() : ""
  const body = notes.trim()
  return issue ? `${REPAIR_ISSUE_PREFIX}${issue}${body ? `\n${body}` : ""}` : body
}

// A task bundled onto a job's visit — saved as its own schedule job with the
// parent's customer, order, date, time, address and technicians.
interface TaskDraft {
  key: number
  jobType: ScheduleJobType
  notes: string
  repairIssue: string
  // undefined until edited — a Filter Change task then follows the parent's
  // date, like the parent's own Filters do.
  filterCodes: string | undefined
  // undefined until edited — follows the parent job's address.
  address: string | undefined
}

// Every field the modal lets an admin change on a job before confirming.
interface JobDraft {
  technician: string
  technician2: string
  jobType: ScheduleJobType
  scheduledDate: string
  scheduledTime: string
  // undefined until edited — shown and saved as the job's own location if
  // it has one, else its customer's address (see startingAddress).
  secondaryAddress: string | undefined
  notes: string
  repairIssue: string
  // undefined until the admin (or a date/type change) sets it — shown and
  // saved as the job's starting filters (see startingFilters), which may
  // still be loading when the draft is first created.
  filterCodes: string | undefined
  tasks: TaskDraft[]
}

type JobBaseline = Pick<JobDraft, "jobType" | "scheduledDate" | "scheduledTime" | "notes" | "repairIssue"> & {
  secondaryAddress: string
  filterCodes: string
  // The job's notes exactly as stored, to tell whether they changed.
  rawNotes: string
}

interface ErrandDraft {
  key: number
  technician: string
  technician2: string
  scheduledDate: string
  scheduledTime: string
  address: string
  notes: string
  filterCodes: string
}

export interface AutoSuggestJobItem {
  job: ScheduleJob
  label: string
  // The job's customer (resolved through the order when the job has no
  // customer_id) — additional tasks are saved against it.
  customerId?: string
  // That customer's address: pre-fills the job's Address field when the job
  // has no location of its own. Saved to the job's own location
  // (secondary_address) on Confirm; the customer record is never changed.
  customerAddress?: string
}

export interface AutoSuggestApplyPayload {
  assignments: { jobId: string; technician: string; technician2?: string; changes?: ScheduleJobEdits }[]
  newJobs: ScheduleNewJob[]
}

function baselineFromJob(job: ScheduleJob): JobBaseline {
  const { repairIssue, notes } = splitRepairIssue(job.notes ?? "")
  return {
    jobType: job.jobType,
    scheduledDate: job.scheduledDate,
    scheduledTime: job.scheduledTime ?? "",
    secondaryAddress: job.secondaryAddress ?? "",
    notes,
    repairIssue,
    filterCodes: job.filterCodes ?? "",
    rawNotes: job.notes ?? "",
  }
}

// Only the fields that actually differ from what the job had when the modal
// opened, so Confirm never rewrites a field nobody touched.
type ResolvedJobDraft = JobDraft & { filterCodes: string; secondaryAddress: string }

function changedFields(initial: JobBaseline, draft: ResolvedJobDraft): ScheduleJobEdits | undefined {
  const changes: ScheduleJobEdits = {}
  if (draft.jobType !== initial.jobType) changes.jobType = draft.jobType
  if (draft.scheduledDate !== initial.scheduledDate && draft.scheduledDate) changes.scheduledDate = draft.scheduledDate
  if (draft.scheduledTime !== initial.scheduledTime) changes.scheduledTime = draft.scheduledTime
  if (draft.secondaryAddress !== initial.secondaryAddress) changes.secondaryAddress = draft.secondaryAddress
  const notes = joinRepairIssue(draft.jobType, draft.repairIssue, draft.notes)
  if (notes !== initial.rawNotes.trim()) changes.notes = notes
  if (draft.jobType === "repair" && draft.repairIssue.trim() && draft.repairIssue.trim() !== initial.repairIssue) {
    changes.repairIssue = draft.repairIssue.trim()
  }
  if (draft.filterCodes !== initial.filterCodes) changes.filterCodes = draft.filterCodes
  return Object.keys(changes).length > 0 ? changes : undefined
}

function errandIsComplete(e: ErrandDraft): boolean {
  return isAssignedTechnician(e.technician) && !!e.scheduledDate && !!e.notes.trim()
}

// The Schedule page's Auto-suggest modal: suggests a technician for every
// unassigned job (onPreview, read-only), lets the admin change anything on
// each job — technician and companion, type, repair issue, date, time,
// address, filters, notes — bundle extra tasks onto a job's visit, and add
// custom errands, then saves all of it in one Confirm & Assign (onApply).
// Each technician picker shows that technician's workload this week and
// month. Schedule-only; Filter Change keeps the simpler shared
// BulkTechnicianSuggestDialog, since its apply path can't save these fields.
export function ScheduleAutoSuggestDialog({
  open,
  onOpenChange,
  items,
  defaultErrandDate,
  onPreview,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: AutoSuggestJobItem[]
  defaultErrandDate: string
  onPreview: (ids: string[]) => Promise<BulkSuggestionEntry[]>
  onApply: (payload: AutoSuggestApplyPayload) => Promise<void>
}) {
  const { t } = useTranslation("schedule")
  const { t: tFc } = useTranslation("filterChange")
  const { t: tCommon } = useTranslation("common")
  const { data: products = [] } = useProducts()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: cpSystems = [] } = useCpSystems()
  const filterOptions = React.useMemo(() => getFilterPartOptions(products), [products])
  const workloadIndex = useTechnicianWorkloadIndex()
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()

  const [applying, setApplying] = React.useState(false)
  const [entries, setEntries] = React.useState<Record<string, BulkSuggestionEntry["result"]> | null>(null)
  const [drafts, setDrafts] = React.useState<Record<string, JobDraft>>({})
  const [errands, setErrands] = React.useState<ErrandDraft[]>([])
  const nextKey = React.useRef(1)
  const loading = open && items.length > 0 && entries === null

  // What each job has stored now — the baseline Confirm diffs against, so a
  // pre-filled Filters value (below) that was never saved still gets saved.
  const initialByJobId = React.useMemo(() => {
    const map: Record<string, JobBaseline> = {}
    for (const { job } of items) map[job.id] = baselineFromJob(job)
    return map
  }, [items])

  // Filters a Filter Change job should start with, in order: what the job
  // already has; the Filter on the Filter Change visit it was created for
  // (schedule_job_id); else what the order's CP System says is due at the
  // milestone nearest the job's date (cpSystemDueFiltersForDate — the same
  // rule as the database's cp_system_due_filters()). Blank when the order
  // has no CP System.
  const planFilterByJob = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const p of filterChangePlans) if (p.scheduleJobId && p.filterType) map.set(p.scheduleJobId, p.filterType)
    return map
  }, [filterChangePlans])
  const cpScheduleByOrder = React.useMemo(() => {
    const systemById = new Map(cpSystems.map((s) => [s.id, s]))
    const occurrence0ByEntry = new Map<string, string>()
    for (const p of filterChangePlans) if (p.saleListEntryId && p.occurrenceIndex === 0) occurrence0ByEntry.set(p.saleListEntryId, p.planDate)
    const map = new Map<string, { system: (typeof cpSystems)[number]; anchorDate: string }>()
    for (const e of saleListEntries) {
      const system = e.cpSystemId ? systemById.get(e.cpSystemId) : undefined
      const anchorDate = occurrence0ByEntry.get(e.id) ?? e.cpStart
      if (system && anchorDate && e.orderNumber && (!map.has(e.orderNumber) || e.status === "ACTIVE")) map.set(e.orderNumber, { system, anchorDate })
    }
    return map
  }, [cpSystems, filterChangePlans, saleListEntries])
  const cpDueFilters = React.useCallback(
    (job: ScheduleJob, jobType: ScheduleJobType, date: string) => {
      if (jobType !== "filter_change" || !job.orderNo) return ""
      const schedule = cpScheduleByOrder.get(job.orderNo)
      return schedule ? cpSystemDueFiltersForDate(schedule.system, schedule.anchorDate, date) : ""
    },
    [cpScheduleByOrder]
  )
  const startingFilters = (job: ScheduleJob) =>
    job.filterCodes || planFilterByJob.get(job.id) || cpDueFilters(job, job.jobType, job.scheduledDate)
  // The job's own location if it already has one, else its customer's
  // address — so every card opens with somewhere to go.
  const startingAddress = (item: AutoSuggestJobItem) => item.job.secondaryAddress || item.customerAddress || ""
  const resolvedDraft = (item: AutoSuggestJobItem): ResolvedJobDraft | undefined => {
    const draft = drafts[item.job.id]
    return draft
      ? { ...draft, filterCodes: draft.filterCodes ?? startingFilters(item.job), secondaryAddress: draft.secondaryAddress ?? startingAddress(item) }
      : undefined
  }
  const taskFilters = (job: ScheduleJob, draft: JobDraft, task: TaskDraft) =>
    task.jobType === "filter_change" ? (task.filterCodes ?? cpDueFilters(job, "filter_change", draft.scheduledDate)) : ""

  // Jobs whose Filters the admin has edited by hand — a date/type change
  // then leaves them alone instead of recalculating over their edit.
  const [filtersEdited, setFiltersEdited] = React.useState<Set<string>>(new Set())

  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setEntries(null)
      setDrafts({})
      setErrands([])
      setFiltersEdited(new Set())
      exitFullScreen()
    }
  }

  React.useEffect(() => {
    if (!open || items.length === 0) return
    let cancelled = false
    const ids = items.map((i) => i.job.id)
    const draftFor = (id: string, technician: string): JobDraft => {
      const base = initialByJobId[id]
      return {
        jobType: base.jobType,
        scheduledDate: base.scheduledDate,
        scheduledTime: base.scheduledTime,
        secondaryAddress: undefined,
        notes: base.notes,
        repairIssue: base.repairIssue,
        filterCodes: undefined,
        technician,
        technician2: "",
        tasks: [],
      }
    }
    onPreview(ids)
      .then((results) => {
        if (cancelled) return
        const nextEntries: Record<string, BulkSuggestionEntry["result"]> = {}
        const nextDrafts: Record<string, JobDraft> = {}
        for (const { id, result } of results) nextEntries[id] = result
        for (const id of ids) {
          const result = nextEntries[id]
          nextDrafts[id] = draftFor(id, result && !("error" in result) ? result.technician : "")
        }
        setEntries(nextEntries)
        setDrafts(nextDrafts)
      })
      .catch(() => {
        if (cancelled) return
        const nextEntries: Record<string, BulkSuggestionEntry["result"]> = {}
        const nextDrafts: Record<string, JobDraft> = {}
        for (const id of ids) {
          nextEntries[id] = { error: "Failed to load a suggestion." }
          nextDrafts[id] = draftFor(id, "")
        }
        setEntries(nextEntries)
        setDrafts(nextDrafts)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items])

  const updateDraft = (id: string, patch: Partial<JobDraft>) =>
    setDrafts((old) => ({ ...old, [id]: { ...old[id], ...patch } }))
  // A new date (or switching to Filter Change) moves the job to a different
  // milestone, so its CP System filters are recalculated — unless the admin
  // already edited Filters by hand.
  const updateJobSchedule = (job: ScheduleJob, patch: Pick<Partial<JobDraft>, "scheduledDate" | "jobType">) =>
    setDrafts((old) => {
      const next = { ...old[job.id], ...patch }
      if (!filtersEdited.has(job.id) && next.jobType === "filter_change" && next.scheduledDate) {
        const due = cpDueFilters(job, next.jobType, next.scheduledDate)
        if (due) next.filterCodes = due
      }
      return { ...old, [job.id]: next }
    })
  const updateTask = (jobId: string, key: number, patch: Partial<TaskDraft>) =>
    setDrafts((old) => ({
      ...old,
      [jobId]: { ...old[jobId], tasks: old[jobId].tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)) },
    }))
  const addTask = (jobId: string) =>
    setDrafts((old) => {
      const draft = old[jobId]
      const used = new Set([draft.jobType, ...draft.tasks.map((task) => task.jobType)])
      const jobType = (["collection", "filter_change", "repair"] as ScheduleJobType[]).find((type) => !used.has(type)) ?? "collection"
      const task: TaskDraft = { key: nextKey.current++, jobType, notes: "", repairIssue: "", filterCodes: undefined, address: undefined }
      return { ...old, [jobId]: { ...draft, tasks: [...draft.tasks, task] } }
    })
  const removeTask = (jobId: string, key: number) =>
    setDrafts((old) => ({ ...old, [jobId]: { ...old[jobId], tasks: old[jobId].tasks.filter((task) => task.key !== key) } }))
  const updateErrand = (key: number, patch: Partial<ErrandDraft>) =>
    setErrands((old) => old.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  const addErrand = () => {
    const key = nextKey.current++
    setErrands((old) => [
      ...old,
      { key, technician: "", technician2: "", scheduledDate: defaultErrandDate, scheduledTime: "", address: "", notes: "", filterCodes: "" },
    ])
  }

  const assignableJobs = items.filter((i) => isAssignedTechnician(drafts[i.job.id]?.technician))
  const taskCount = assignableJobs.reduce((n, i) => n + (drafts[i.job.id]?.tasks.length ?? 0), 0)
  const incompleteErrands = errands.filter((e) => !errandIsComplete(e)).length
  const saveCount = assignableJobs.length + taskCount + errands.length - incompleteErrands

  async function handleConfirm() {
    const assignments: AutoSuggestApplyPayload["assignments"] = []
    const newJobs: ScheduleNewJob[] = []
    for (const item of assignableJobs) {
      const { job } = item
      const draft = resolvedDraft(item)!
      const technician = draft.technician.trim()
      const technician2 = draft.technician2.trim()
      assignments.push({ jobId: job.id, technician, ...(technician2 ? { technician2 } : {}), changes: changedFields(initialByJobId[job.id], draft) })
      for (const task of draft.tasks) {
        newJobs.push({
          jobType: task.jobType,
          customerId: item.customerId ?? job.customerId,
          orderNo: job.orderNo,
          technician,
          ...(technician2 ? { technician2 } : {}),
          scheduledDate: draft.scheduledDate,
          scheduledTime: draft.scheduledTime,
          address: task.address ?? draft.secondaryAddress,
          notes: joinRepairIssue(task.jobType, task.repairIssue, task.notes),
          filterCodes: taskFilters(job, draft, task),
        })
      }
    }
    for (const e of errands.filter(errandIsComplete)) {
      newJobs.push({
        jobType: "other",
        technician: e.technician.trim(),
        ...(e.technician2.trim() ? { technician2: e.technician2.trim() } : {}),
        scheduledDate: e.scheduledDate,
        scheduledTime: e.scheduledTime,
        address: e.address,
        notes: e.notes,
        filterCodes: e.filterCodes,
      })
    }
    if (assignments.length === 0 && newJobs.length === 0) {
      onOpenChange(false)
      return
    }
    setApplying(true)
    try {
      await onApply({ assignments, newJobs })
      onOpenChange(false)
    } finally {
      setApplying(false)
    }
  }

  const filterPicker = (value: string, onCommit: (next: string) => void) => (
    <InlineGridPickerCell
      value={value}
      options={filterOptions}
      placeholder={tFc("filterPickerPlaceholder")}
      otherLabel={tFc("filterPickerOtherLabel")}
      doneLabel={tFc("filterPickerDone")}
      customPlaceholder={tFc("filterPickerCustomPlaceholder")}
      addLabel={tFc("filterPickerAddCustom")}
      onCommit={onCommit}
    />
  )
  const jobTypeSelect = (value: ScheduleJobType, onChange: (next: ScheduleJobType) => void) => (
    <Select value={value} onValueChange={(v) => onChange(v as ScheduleJobType)}>
      <SelectTrigger className="h-8 w-full text-xs" aria-label={t("editJobType")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {JOB_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {t(type)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const repairIssueInput = (value: string, onChange: (next: string) => void) => (
    <Combobox
      value={value}
      onChange={onChange}
      options={REPAIR_ISSUE_OPTIONS}
      showAllOnExactMatch
      placeholder={t("repairIssuePlaceholder")}
      aria-label={t("repairIssue")}
      className="h-8 w-full text-xs"
    />
  )
  const technicianPicker = (primary: string, secondary: string, onCommit: (patch: { technician?: string; technician2?: string }) => void) => (
    <>
      <InlineTechnicianPairCell
        primary={primary}
        secondary={secondary}
        onCommit={(patch) =>
          onCommit({
            ...(patch.primary !== undefined ? { technician: patch.primary } : {}),
            ...(patch.secondary !== undefined ? { technician2: patch.secondary } : {}),
          })
        }
      />
      <WorkloadSummary names={[primary, secondary]} index={workloadIndex} />
    </>
  )
  const gridClass = isFullScreen ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-4" : "grid gap-3 sm:grid-cols-2"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isFullScreen
            ? "sm:max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden"
            : "sm:max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        }
      >
        <FullScreenToggleButton isFullScreen={isFullScreen} onToggle={toggleFullScreen} className="absolute top-2 right-10" />
        <DialogHeader>
          <DialogTitle>{t("autoSuggestConfirmTitle", { count: String(items.length) })}</DialogTitle>
          <DialogDescription>{items.length > 0 ? t("autoSuggestConfirmDescription") : t("noUnassignedJobs")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {loading
            ? Array.from({ length: Math.min(items.length, 3) }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)
            : items.map((item) => {
                const { job, label, customerAddress } = item
                const draft = resolvedDraft(item)
                if (!draft) return null
                const result = entries?.[job.id]
                const suggestion = result && !("error" in result) ? (result as TechnicianSuggestion) : undefined
                return (
                  <div key={job.id} data-testid="auto-suggest-job" className="space-y-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{label}</div>
                      {result && "error" in result ? (
                        <div className="text-xs text-danger">{result.error}</div>
                      ) : suggestion ? (
                        <div className="text-xs text-muted-foreground">
                          {suggestion.explanation}
                          {suggestion.outsideCoverage && (
                            <Badge variant="outline" className="ml-1.5 border-amber-600/40 text-amber-600">
                              {t("outsideUsualCoverage")}
                            </Badge>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className={gridClass}>
                      <Field label={t("editTechnicians")}>
                        {technicianPicker(draft.technician, draft.technician2, (patch) => updateDraft(job.id, patch))}
                      </Field>
                      <Field label={t("editJobType")}>{jobTypeSelect(draft.jobType, (jobType) => updateJobSchedule(job, { jobType }))}</Field>
                      {draft.jobType === "repair" && (
                        <Field label={t("repairIssue")}>
                          {repairIssueInput(draft.repairIssue, (repairIssue) => updateDraft(job.id, { repairIssue }))}
                        </Field>
                      )}
                      <Field label={t("editDate")}>
                        <Input
                          type="date"
                          className="h-8 text-xs"
                          aria-label={t("editDate")}
                          value={draft.scheduledDate}
                          onChange={(e) => updateJobSchedule(job, { scheduledDate: e.target.value })}
                        />
                      </Field>
                      <Field label={t("editTime")}>
                        <Input
                          className="h-8 text-xs"
                          aria-label={t("editTime")}
                          placeholder={t("editTimePlaceholder")}
                          value={draft.scheduledTime}
                          onChange={(e) => updateDraft(job.id, { scheduledTime: e.target.value })}
                        />
                      </Field>
                      <Field label={t("editFilters")}>
                        {filterPicker(draft.filterCodes, (next) => {
                          setFiltersEdited((old) => new Set(old).add(job.id))
                          updateDraft(job.id, { filterCodes: next })
                        })}
                      </Field>
                      <Field
                        label={t("editAddress")}
                        hint={customerAddress && draft.secondaryAddress !== customerAddress ? t("customerAddressHint", { address: customerAddress }) : undefined}
                      >
                        <Input
                          className="h-8 text-xs"
                          aria-label={t("editAddress")}
                          placeholder={t("editAddressPlaceholder")}
                          value={draft.secondaryAddress}
                          onChange={(e) => updateDraft(job.id, { secondaryAddress: e.target.value })}
                        />
                      </Field>
                      <Field label={t("editNotes")} className="sm:col-span-2">
                        <Textarea
                          rows={2}
                          className="min-h-0 text-xs"
                          aria-label={t("editNotes")}
                          value={draft.notes}
                          onChange={(e) => updateDraft(job.id, { notes: e.target.value })}
                        />
                      </Field>
                    </div>

                    {draft.tasks.map((task) => (
                      <div key={task.key} data-testid="additional-task" className="space-y-2 rounded-md border border-dashed bg-muted/30 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-medium">{t("additionalTask")}</div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label={t("removeTask")}
                            onClick={() => removeTask(job.id, task.key)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className={gridClass}>
                          <Field label={t("editJobType")}>{jobTypeSelect(task.jobType, (jobType) => updateTask(job.id, task.key, { jobType }))}</Field>
                          {task.jobType === "repair" && (
                            <Field label={t("repairIssue")}>
                              {repairIssueInput(task.repairIssue, (repairIssue) => updateTask(job.id, task.key, { repairIssue }))}
                            </Field>
                          )}
                          {task.jobType === "filter_change" && (
                            <Field label={t("editFilters")}>
                              {filterPicker(taskFilters(job, draft, task), (next) => updateTask(job.id, task.key, { filterCodes: next }))}
                            </Field>
                          )}
                          <Field label={t("editAddress")}>
                            <Input
                              className="h-8 text-xs"
                              aria-label={t("editAddress")}
                              placeholder={t("editAddressPlaceholder")}
                              value={task.address ?? draft.secondaryAddress}
                              onChange={(e) => updateTask(job.id, task.key, { address: e.target.value })}
                            />
                          </Field>
                          <Field label={t("editNotes")} className="sm:col-span-2">
                            <Textarea
                              rows={1}
                              className="min-h-0 text-xs"
                              aria-label={t("editNotes")}
                              value={task.notes}
                              onChange={(e) => updateTask(job.id, task.key, { notes: e.target.value })}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => addTask(job.id)} disabled={applying}>
                      <Plus className="h-3.5 w-3.5" /> {t("addAdditionalTask")}
                    </Button>
                  </div>
                )
              })}

          {errands.map((errand) => (
            <div key={errand.key} data-testid="custom-errand" className="space-y-3 rounded-lg border border-dashed border-primary/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{t("customErrand")}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={t("removeErrand")}
                  onClick={() => setErrands((old) => old.filter((e) => e.key !== errand.key))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className={gridClass}>
                <Field label={t("editTechnicians")}>
                  {technicianPicker(errand.technician, errand.technician2, (patch) => updateErrand(errand.key, patch))}
                </Field>
                <Field label={t("editDate")}>
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    aria-label={t("editDate")}
                    value={errand.scheduledDate}
                    onChange={(e) => updateErrand(errand.key, { scheduledDate: e.target.value })}
                  />
                </Field>
                <Field label={t("editTime")}>
                  <Input
                    className="h-8 text-xs"
                    aria-label={t("editTime")}
                    placeholder={t("editTimePlaceholder")}
                    value={errand.scheduledTime}
                    onChange={(e) => updateErrand(errand.key, { scheduledTime: e.target.value })}
                  />
                </Field>
                <Field label={t("editAddress")}>
                  <Input
                    className="h-8 text-xs"
                    aria-label={t("editAddress")}
                    placeholder={t("errandAddressPlaceholder")}
                    value={errand.address}
                    onChange={(e) => updateErrand(errand.key, { address: e.target.value })}
                  />
                </Field>
                <Field label={t("editFilters")}>{filterPicker(errand.filterCodes, (next) => updateErrand(errand.key, { filterCodes: next }))}</Field>
                <Field label={t("errandDescription")} className="sm:col-span-2">
                  <Textarea
                    rows={2}
                    className="min-h-0 text-xs"
                    aria-label={t("errandDescription")}
                    placeholder={t("errandDescriptionPlaceholder")}
                    value={errand.notes}
                    onChange={(e) => updateErrand(errand.key, { notes: e.target.value })}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addErrand} disabled={applying}>
            <Plus className="h-4 w-4" /> {t("addCustomErrand")}
          </Button>
        </DialogBody>

        <DialogFooter className="items-center">
          {incompleteErrands > 0 && <p className="mr-auto text-xs text-danger">{t("errandIncomplete")}</p>}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={loading || applying || saveCount === 0 || incompleteErrands > 0}>
            {applying ? tCommon("saving") : `${t("confirmAndAssign")} (${saveCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && (
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={hint}>
          {hint}
        </p>
      )}
    </div>
  )
}

// Each picked technician's jobs this week and this month, done / assigned
// (see technician-workload.ts for what counts), so the admin can see who is
// already busy before assigning more. Full detail in the hover title.
function WorkloadSummary({ names, index }: { names: string[]; index: Map<string, WorkloadCounts> }) {
  const { t } = useTranslation("schedule")
  const periods = workloadPeriodLabels()
  const picked = names.map((n) => n.trim()).filter((n) => isAssignedTechnician(n))
  if (picked.length === 0) return null
  return (
    <div className="mt-1 space-y-0.5">
      {picked.map((name) => {
        const c = workloadFor(index, name)
        const vars = {
          name,
          weekDone: String(c.weekCompleted),
          weekAssigned: String(c.weekAssigned),
          monthDone: String(c.monthCompleted),
          monthAssigned: String(c.monthAssigned),
          week: periods.week,
          month: periods.month,
        }
        return (
          <p key={name} data-testid="technician-workload" className="text-[11px] text-muted-foreground" title={t("workloadTooltip", vars)}>
            <span className="font-medium text-foreground">{name}</span> · {t("workloadSummary", vars)}
          </p>
        )
      })}
    </div>
  )
}
