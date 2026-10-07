"use client"

import * as React from "react"
import { CheckCheck, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InlineComboboxCell, InlineDateCell, InlineTextAreaCell } from "@/components/shared/inline-edit-cell"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { isSaturday } from "@/lib/schedule-timeframe"
import { crewForVehicle, isAssignedTechnician, normalizeTechnicianPair } from "@/lib/technicians"
import { VEHICLE_TYPES } from "@/lib/constants"
import { cn } from "@/lib/utils"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"

const VEHICLE_OPTIONS = VEHICLE_TYPES.map((v) => ({ value: v }))

// One visit's job as proposed / edited in the review.
export interface VisitDraft {
  date: string
  primary: string
  secondary: string
  vehicle: string
  detail: string
  remarks: string
  // The admin picked this technician by hand (activates a Saturday job).
  technicianChosen: boolean
}

// Itemized review before Bulk Create / Approve All & Dispatch: every visit
// as the job it will become, every field editable. Edits stay here until
// "Confirm & Create Jobs"; Cancel creates nothing. The Schedule table's own
// rules apply: moving a job onto a Saturday clears its technician and
// vehicle (Saturday is assigned by hand), picking a technician for it makes
// it active, and the Liteace brings its crew. A weekday job needs a
// technician before it can be created.
export function VisitDispatchReview({
  open,
  onOpenChange,
  title,
  visits,
  initial,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  visits: UnscheduledVisit[]
  // The proposal for each visit (held inline edits, planned technician, or
  // the automatic assignment).
  initial: (visit: UnscheduledVisit) => VisitDraft
  onConfirm: (items: { visit: UnscheduledVisit; draft: VisitDraft }[]) => Promise<void>
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const [drafts, setDrafts] = React.useState<Record<string, VisitDraft>>({})
  const [touched, setTouched] = React.useState<Set<string>>(new Set())
  const [saving, setSaving] = React.useState(false)
  // A fresh proposal every time it opens.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDrafts(Object.fromEntries(visits.map((v) => [v.key, initial(v)])))
      setTouched(new Set())
    }
  }

  const rows = visits.map((visit) => ({ visit, draft: drafts[visit.key] ?? initial(visit) }))
  const update = (visit: UnscheduledVisit, patch: Partial<VisitDraft>) => {
    setDrafts((d) => ({ ...d, [visit.key]: { ...(d[visit.key] ?? initial(visit)), ...patch } }))
    setTouched((s) => new Set(s).add(visit.key))
  }
  const setDate = (visit: UnscheduledVisit, current: VisitDraft, date: string) =>
    update(visit, isSaturday(date) && !isSaturday(current.date) ? { date, primary: "", secondary: "", vehicle: "", technicianChosen: false } : { date })
  const setTechnicians = (visit: UnscheduledVisit, current: VisitDraft, p: { primary?: string; secondary?: string }) => {
    const pair = normalizeTechnicianPair(p.primary ?? current.primary, p.secondary ?? current.secondary)
    update(visit, { primary: pair.primary, secondary: pair.secondary, technicianChosen: isAssignedTechnician(pair.primary) })
  }
  const setVehicle = (visit: UnscheduledVisit, vehicle: string) => {
    const crew = crewForVehicle(vehicle)
    update(visit, { vehicle, ...(crew ? { primary: crew.primary, secondary: crew.secondary, technicianChosen: true } : {}) })
  }

  const needsTechnician = (d: VisitDraft) => !isAssignedTechnician(d.primary)
  const weekdayMissing = rows.filter((r) => needsTechnician(r.draft) && !isSaturday(r.draft.date)).length
  const saturdayMissing = rows.filter((r) => needsTechnician(r.draft) && isSaturday(r.draft.date)).length

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm(rows)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent
        className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0"
        data-testid="visit-dispatch-review"
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[data-slot="popover-content"], [role="listbox"], [role="dialog"]')) e.preventDefault()
        }}
      >
        <DialogHeader className="border-b p-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <CheckCheck className="h-4 w-4 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription className="sr-only">{t("visitReviewBanner", { count: rows.length })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm" data-testid="visit-review-banner">
          <span className="font-medium">{t("visitReviewBanner", { count: rows.length })}</span>
          {weekdayMissing > 0 && <span className="text-destructive">{t("visitReviewWeekdayMissing", { count: weekdayMissing })}</span>}
          {saturdayMissing > 0 && <span className="text-warning">{t("visitReviewSaturdayMissing", { count: saturdayMissing })}</span>}
          {touched.size > 0 && <span className="text-muted-foreground">{t("monthReviewEdited", { count: touched.size })}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => onOpenChange(false)} data-testid="visit-review-cancel">
              {tCommon("cancel")}
            </Button>
            <Button size="sm" className="gap-1.5" disabled={saving || rows.length === 0 || weekdayMissing > 0} onClick={confirm} data-testid="visit-review-confirm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
              {t("visitReviewConfirm", { count: rows.length })}
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="text-left text-xs text-muted-foreground">
                {(["tableDate", "tableJobType", "tableCustomerOrder", "tableAddress", "tableTechnician", "tableVehicle", "tableDetails", "tableRemarks"] as const).map((key) => (
                  <th key={key} className="whitespace-nowrap px-2 py-2 font-medium">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ visit, draft }) => {
                const missing = needsTechnician(draft)
                const saturday = isSaturday(draft.date)
                return (
                  <tr
                    key={visit.key}
                    data-testid="visit-review-row"
                    data-needs-technician={missing || undefined}
                    className={cn("border-t align-top", missing && (saturday ? "bg-warning/5" : "bg-destructive/5"))}
                  >
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <InlineDateCell value={draft.date} onCommit={(next) => next && setDate(visit, draft, next)} />
                      {saturday && <div className="mt-0.5 text-[11px] font-medium text-warning">{t("monthReviewSaturday")}</div>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{t(visit.jobType)}</td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{visit.name}</div>
                      <div className="text-xs text-muted-foreground">{visit.orderNo}</div>
                    </td>
                    <td className="max-w-[16rem] px-2 py-1.5 text-xs">{visit.address || "—"}</td>
                    <td className={cn("min-w-[15rem] px-2 py-1.5", missing && !saturday && "rounded ring-1 ring-destructive/40")}>
                      <InlineTechnicianPairCell primary={draft.primary} secondary={draft.secondary} onCommit={(p) => setTechnicians(visit, draft, p)} />
                      {missing && (
                        <Badge variant="outline" className="mt-1 h-5 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive">
                          {t("needsTechnician")}
                        </Badge>
                      )}
                    </td>
                    <td className="min-w-[9rem] px-2 py-1.5">
                      <InlineComboboxCell
                        value={draft.vehicle}
                        options={VEHICLE_OPTIONS}
                        placeholder={t("selectVehicle")}
                        commitOnSelect
                        showAllOnExactMatch
                        onCommit={(next) => setVehicle(visit, next.trim())}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextAreaCell value={draft.detail} className="w-56" onCommit={(next) => update(visit, { detail: next })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <InlineTextAreaCell value={draft.remarks} className="w-44" onCommit={(next) => update(visit, { remarks: next })} />
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
