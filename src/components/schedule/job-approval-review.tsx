"use client"

import * as React from "react"
import { CheckCheck, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineComboboxCell, InlineTextAreaCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { isAssignedTechnician, normalizeTechnicianPair, crewFillForVehicle } from "@/lib/technicians"
import { VEHICLE_TYPES } from "@/lib/constants"
import { cn, formatDate } from "@/lib/utils"
import type { ScheduleJob } from "@/lib/types"

const VEHICLE_OPTIONS = VEHICLE_TYPES.map((v) => ({ value: v }))

// One job's technicians / vehicle / notes as reviewed (edited or as-is).
export interface JobApprovalEdit {
  primary: string
  secondary: string
  vehicle: string
  notes: string
}

// "Review & Edit Batch Approvals" — opens instead of approving at once (the
// Schedule panel's "Approve All for <date>"). Every queued draft job is
// listed with its technicians, vehicle and notes editable and a checkbox to
// leave it out of this batch; nothing is saved until "Confirm & Approve",
// which approves only the ticked jobs, with their edits. A ticked job needs a
// technician. Cancel saves nothing.
export function JobApprovalReview({
  open,
  onOpenChange,
  jobs,
  customerName,
  jobTypeLabel,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: ScheduleJob[]
  customerName: (job: ScheduleJob) => string | undefined
  jobTypeLabel: (job: ScheduleJob) => string
  // Only the ticked jobs, each with its (possibly unchanged) edit and whether
  // the admin changed anything on it.
  onConfirm: (items: { job: ScheduleJob; edit: JobApprovalEdit; changed: boolean }[]) => Promise<void>
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const initial = (job: ScheduleJob): JobApprovalEdit => ({
    primary: job.technician ?? "",
    secondary: job.technician2 ?? "",
    vehicle: job.vehicle ?? "",
    notes: job.notes ?? "",
  })
  const [edits, setEdits] = React.useState<Record<string, JobApprovalEdit>>({})
  const [included, setIncluded] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  // Fresh every time it opens: no edits, every job ticked.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setEdits({})
      setIncluded(new Set(jobs.map((j) => j.id)))
    }
  }

  const rows = jobs.map((job) => ({ job, edit: edits[job.id] ?? initial(job), changed: !!edits[job.id] }))
  const selectedRows = rows.filter((r) => included.has(r.job.id))
  const update = (job: ScheduleJob, patch: Partial<JobApprovalEdit>) =>
    setEdits((e) => ({ ...e, [job.id]: { ...(e[job.id] ?? initial(job)), ...patch } }))
  const setTechnicians = (job: ScheduleJob, current: JobApprovalEdit, p: { primary?: string; secondary?: string }) => {
    const pair = normalizeTechnicianPair(p.primary ?? current.primary, p.secondary ?? current.secondary)
    update(job, { primary: pair.primary, secondary: pair.secondary })
  }
  // A vehicle with a fixed crew (the Liteace) brings its two technicians.
  // The technician's other jobs that day in this batch take the same vehicle:
  // those with none yet, and those still on the vehicle this job had (so a
  // change follows through); a job set to a different vehicle on purpose
  // keeps it.
  const setVehicle = (job: ScheduleJob, vehicle: string) => {
    const current = edits[job.id] ?? initial(job)
    const crew = crewFillForVehicle(vehicle, current.primary)
    const primary = (crew?.primary ?? current.primary).trim().toLowerCase()
    const previous = current.vehicle.trim().toLowerCase()
    setEdits((e) => {
      const next = { ...e, [job.id]: { ...current, vehicle, ...(crew ? { primary: crew.primary, secondary: crew.secondary } : {}) } }
      if (!isAssignedTechnician(primary)) return next
      for (const other of jobs) {
        if (other.id === job.id || other.scheduledDate !== job.scheduledDate) continue
        const o = e[other.id] ?? initial(other)
        if (o.primary.trim().toLowerCase() !== primary) continue
        const theirs = o.vehicle.trim().toLowerCase()
        if (theirs && theirs !== previous) continue
        next[other.id] = { ...o, vehicle }
      }
      return next
    })
  }
  const toggle = (id: string) =>
    setIncluded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allState: boolean | "indeterminate" = selectedRows.length === 0 ? false : selectedRows.length === rows.length ? true : "indeterminate"
  const missing = selectedRows.filter((r) => !isAssignedTechnician(r.edit.primary)).length
  const editedCount = rows.filter((r) => r.changed).length

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm(selectedRows)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0"
        data-testid="job-approval-review"
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[data-slot="popover-content"], [role="listbox"], [role="dialog"]')) e.preventDefault()
        }}
      >
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" /> {t("batchReviewTitle")}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("batchReviewSelected", { selected: selectedRows.length, count: rows.length })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm" data-testid="job-review-banner">
          <span className="font-medium">{t("batchReviewSelected", { selected: selectedRows.length, count: rows.length })}</span>
          {missing > 0 && <span className="text-destructive">{t("batchReviewMissingTechnician", { count: missing })}</span>}
          {editedCount > 0 && <span className="text-muted-foreground">{t("monthReviewEdited", { count: editedCount })}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)} data-testid="job-review-cancel">
              {tCommon("cancel")}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={saving || selectedRows.length === 0 || missing > 0} onClick={confirm} data-testid="job-review-confirm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              {t("batchReviewConfirmJobs", { count: selectedRows.length })}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={allState}
                    onCheckedChange={() => setIncluded(allState === true ? new Set() : new Set(jobs.map((j) => j.id)))}
                    aria-label={t("batchReviewSelectAll")}
                    data-testid="job-review-select-all"
                  />
                </th>
                {(["tableDate", "tableJobType", "tableCustomerOrder", "tableTechnician", "tableVehicle", "tableNotes"] as const).map((key) => (
                  <th key={key} className="whitespace-nowrap px-2 py-2 font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, edit }) => {
                const on = included.has(job.id)
                const noTech = !isAssignedTechnician(edit.primary)
                return (
                  <tr
                    key={job.id}
                    data-testid="job-review-row"
                    data-included={on || undefined}
                    className={cn("border-t align-top", !on && "opacity-50", on && noTech && "bg-destructive/5")}
                  >
                    <td className="px-2 py-2">
                      <Checkbox checked={on} onCheckedChange={() => toggle(job.id)} aria-label={t("batchReviewInclude")} data-testid="job-review-include" />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(job.scheduledDate)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{jobTypeLabel(job)}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{customerName(job) || "—"}</div>
                      <div className="text-xs text-muted-foreground">{job.orderNo || "—"}</div>
                    </td>
                    <td className={cn("min-w-[15rem] px-2 py-1.5", on && noTech && "rounded ring-1 ring-destructive/40")}>
                      <InlineTechnicianPairCell primary={edit.primary} secondary={edit.secondary} onCommit={(p) => setTechnicians(job, edit, p)} />
                      {noTech && (
                        <Badge variant="outline" className="mt-1 h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
                          {t("needsTechnician")}
                        </Badge>
                      )}
                    </td>
                    <td className="min-w-[9rem] px-2 py-1.5">
                      <InlineComboboxCell
                        value={edit.vehicle}
                        options={VEHICLE_OPTIONS}
                        placeholder={t("selectVehicle")}
                        commitOnSelect
                        showAllOnExactMatch
                        onCommit={(next) => setVehicle(job, next.trim())}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextAreaCell value={edit.notes} className="w-72" onCommit={(next) => update(job, { notes: next })} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
