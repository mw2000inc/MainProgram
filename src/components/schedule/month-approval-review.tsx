"use client"

import * as React from "react"
import { CheckCheck, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineComboboxCell, InlineDateCell, InlineTextAreaCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { JOB_TYPE_LABELS } from "@/components/schedule/schedule-columns"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { isSaturday } from "@/lib/schedule-timeframe"
import { isAssignedTechnician } from "@/lib/technicians"
import { VEHICLE_TYPES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { ScheduleJob } from "@/lib/types"

export type JobPatch = Partial<Omit<ScheduleJob, "id" | "createdAt">>

const VEHICLE_OPTIONS = VEHICLE_TYPES.map((v) => ({ value: v }))

// "Approve All for Month": every draft for the month in one editable table.
// Edits made here are STAGED — nothing is saved until "Confirm Approve All",
// which saves each job's edits together with its approval; Cancel (or
// closing) discards them. The edit rules are the Schedule table's own,
// passed in (dateChange: moving onto a Saturday clears the technicians;
// technicianChange: re-links logins; vehiclePatch: the Liteace brings its
// crew), applied to the job as already edited.
export function MonthApprovalReview({
  open,
  onOpenChange,
  jobs,
  monthLabel,
  customerLabel,
  dateChange,
  technicianChange,
  vehiclePatch,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: ScheduleJob[]
  monthLabel: string
  customerLabel: (job: ScheduleJob) => string
  dateChange: (job: ScheduleJob, date: string) => JobPatch
  technicianChange: (job: ScheduleJob, primary: string, secondary: string) => JobPatch
  vehiclePatch: (vehicle: string) => JobPatch
  onConfirm: (items: { job: ScheduleJob; patch: JobPatch }[]) => Promise<void>
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const [staged, setStaged] = React.useState<Record<string, JobPatch>>({})
  const [saving, setSaving] = React.useState(false)
  // A fresh review every time it opens.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setStaged({})
  }

  const rows = React.useMemo(
    () => [...jobs].map((job) => ({ job, current: { ...job, ...staged[job.id] } as ScheduleJob })).sort((a, b) => a.current.scheduledDate.localeCompare(b.current.scheduledDate)),
    [jobs, staged]
  )
  const stage = (job: ScheduleJob, patch: JobPatch) => setStaged((s) => ({ ...s, [job.id]: { ...s[job.id], ...patch } }))
  const editedCount = Object.keys(staged).length
  const unassignedSaturdays = rows.filter((r) => isSaturday(r.current.scheduledDate) && !isAssignedTechnician(r.current.technician)).length
  const unassigned = rows.filter((r) => !isAssignedTechnician(r.current.technician)).length

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm(rows.map(({ job }) => ({ job, patch: staged[job.id] ?? {} })))
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0"
        data-testid="month-approval-review"
        // The editors' own popovers/listboxes portal outside this dialog.
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[data-slot="popover-content"], [role="listbox"], [role="dialog"]')) e.preventDefault()
        }}
      >
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" /> {t("monthReviewTitle", { month: monthLabel })}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("monthReviewBanner", { count: rows.length, month: monthLabel })}</DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm"
          data-testid="month-approval-banner"
        >
          <span className="font-medium">{t("monthReviewBanner", { count: rows.length, month: monthLabel })}</span>
          {unassignedSaturdays > 0 && <span className="text-destructive">{t("monthReviewSaturdays", { count: unassignedSaturdays })}</span>}
          {unassigned > unassignedSaturdays && <span className="text-destructive">{t("monthReviewUnassigned", { count: unassigned - unassignedSaturdays })}</span>}
          {editedCount > 0 && <span className="text-muted-foreground">{t("monthReviewEdited", { count: editedCount })}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)} data-testid="month-approval-cancel">
              {tCommon("cancel")}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={saving || rows.length === 0} onClick={confirm} data-testid="month-approval-confirm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              {t("monthReviewConfirm", { count: rows.length })}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="text-left text-xs text-muted-foreground">
                {(["tableDate", "tableJobType", "monthReviewCustomer", "tableTechnician", "tableVehicle", "tableOrderNo", "tableNotes", "tableRemarks", "tableStatus"] as const).map((key) => (
                  <th key={key} className="whitespace-nowrap px-2 py-2 font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, current }) => {
                const needsTechnician = !isAssignedTechnician(current.technician)
                const saturday = isSaturday(current.scheduledDate)
                return (
                  <tr
                    key={job.id}
                    data-testid="month-approval-row"
                    data-needs-technician={needsTechnician || undefined}
                    className={cn("border-t align-top", needsTechnician && "bg-destructive/5", staged[job.id] && "outline-1 -outline-offset-1 outline-primary/30")}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <InlineDateCell value={current.scheduledDate} onCommit={(next) => next && stage(job, dateChange(current, next))} />
                      {saturday && <div className="mt-0.5 text-[11px] font-medium text-warning">{t("monthReviewSaturday")}</div>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{JOB_TYPE_LABELS[current.jobType]}</td>
                    <td className="px-2 py-1.5 max-w-[16rem] truncate" title={customerLabel(current)}>
                      {customerLabel(current) || "—"}
                    </td>
                    <td className={cn("px-2 py-1.5 min-w-[15rem]", needsTechnician && "rounded ring-1 ring-destructive/40")}>
                      <InlineTechnicianPairCell
                        primary={current.technician}
                        secondary={current.technician2}
                        onCommit={(p) => stage(job, technicianChange(current, p.primary ?? current.technician, p.secondary ?? current.technician2 ?? ""))}
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[9rem]">
                      <InlineComboboxCell
                        value={current.vehicle}
                        options={VEHICLE_OPTIONS}
                        placeholder={t("selectVehicle")}
                        commitOnSelect
                        showAllOnExactMatch
                        onCommit={(next) => stage(job, vehiclePatch(next.trim()))}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextCell value={current.orderNo} className="w-28" onCommit={(next) => stage(job, { orderNo: next.trim() })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextAreaCell value={current.notes} className="w-64" onCommit={(next) => stage(job, { notes: next })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextAreaCell value={current.remarks} className="w-48" onCommit={(next) => stage(job, { remarks: next })} />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap space-y-1">
                      <Badge variant="outline" className="h-5 border-warning/50 bg-warning/15 px-1.5 text-[10px] font-semibold uppercase text-warning">
                        {t("monthReviewDraft")}
                      </Badge>
                      {needsTechnician && (
                        <div>
                          <Badge variant="outline" className="h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
                            {t("needsTechnician")}
                          </Badge>
                        </div>
                      )}
                      {staged[job.id] && <div className="text-[11px] text-primary">{t("monthReviewEditedBadge")}</div>}
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
