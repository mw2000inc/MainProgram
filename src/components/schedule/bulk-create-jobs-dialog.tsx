"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TechnicianCombobox } from "@/components/shared/technician-combobox"
import { createScheduleJob, linkVisitToScheduleJob, updateScheduleJob } from "@/lib/api/schedule"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { useUsers } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { VEHICLE_TYPES } from "@/lib/constants"
import { crewForVehicle, isAssignedTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { todayIso } from "@/lib/utils"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"

const NONE = "__none"

// "Bulk Create Jobs" for the Schedule's Unscheduled Visits: one technician /
// vehicle / date applied to every selected visit, a schedule job created
// for each and linked to that exact visit (so it leaves the list).
//
// Each job is created as 'pending_approval', linked to its visit, then set to
// 'pending' (active) — so the database's job→record sync, which runs when a
// job becomes active, finds the visit already linked and never attaches the
// job to a different visit of the same order. The visits were already
// dispatch-confirmed, so the jobs don't wait for a second approval.
export function BulkCreateJobsDialog({
  open,
  onOpenChange,
  visits,
  // The date each visit goes on when "each visit's own date" is chosen
  // (Friday → Saturday, a carried Friday visit → the day being viewed).
  ownDateFor,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  visits: UnscheduledVisit[]
  ownDateFor: (visit: UnscheduledVisit) => string
  onDone: () => void
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const qc = useQueryClient()
  const { data: users = [] } = useUsers()
  const accounts = React.useMemo(() => users.filter((u) => u.role === "technician"), [users])

  const [technician, setTechnician] = React.useState("")
  const [technician2, setTechnician2] = React.useState("")
  const [vehicle, setVehicle] = React.useState("")
  const [dateMode, setDateMode] = React.useState<"own" | "fixed">("own")
  const [fixedDate, setFixedDate] = React.useState(todayIso())
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)

  // A vehicle with a fixed crew (the Liteace) brings its two technicians.
  const pickVehicle = (value: string) => {
    const v = value === NONE ? "" : value
    setVehicle(v)
    const crew = crewForVehicle(v)
    if (crew) {
      setTechnician(crew.primary)
      setTechnician2(crew.secondary)
    }
  }

  const pairFor = (visit: UnscheduledVisit) =>
    technician.trim() ? normalizeTechnicianPair(technician, technician2) : normalizeTechnicianPair(visit.technician, visit.technician2)
  const missingTechnician = visits.filter((v) => !isAssignedTechnician(pairFor(v).primary))
  const creatable = visits.filter((v) => isAssignedTechnician(pairFor(v).primary))
  const invalidDate = dateMode === "fixed" && (!fixedDate || fixedDate < todayIso())

  async function create() {
    setProgress({ done: 0, total: creatable.length })
    let created = 0
    const failed: string[] = []
    for (const visit of creatable) {
      const pair = pairFor(visit)
      try {
        const job = await createScheduleJob({
          jobType: visit.jobType,
          status: "pending_approval",
          scheduledDate: dateMode === "fixed" ? fixedDate : ownDateFor(visit),
          orderNo: visit.orderNo,
          customerId: visit.customerId,
          technician: pair.primary,
          technician2: pair.secondary,
          ...technicianAccountIds(pair.primary, pair.secondary, accounts),
          vehicle,
          secondaryAddress: visit.address,
          notes: [visit.name, visit.detail].filter(Boolean).join(" — "),
          filterCodes: visit.filterCodes,
        })
        await linkVisitToScheduleJob(visit.table, visit.recordId, job.id)
        await updateScheduleJob(job.id, { status: "pending" })
        created += 1
      } catch (error) {
        failed.push(`${visit.orderNo}: ${error instanceof Error ? error.message : String(error)}`)
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setProgress(null)
    if (created) toast.success(t("bulkCreated", { count: created }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
    onDone()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !progress && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg" data-testid="bulk-create-jobs">
        <DialogHeader>
          <DialogTitle>{t("bulkCreateTitle", { count: visits.length })}</DialogTitle>
          <DialogDescription>{t("bulkCreateDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>{t("vehicleOptional")}</Label>
            <Select value={vehicle || NONE} onValueChange={pickVehicle}>
              <SelectTrigger className="w-full" data-testid="bulk-vehicle">
                <SelectValue placeholder={t("selectVehicle")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tCommon("none")}</SelectItem>
                {VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>{t("technician")}</Label>
            <TechnicianCombobox value={technician} onChange={setTechnician} placeholder={t("bulkTechnicianPlaceholder")} />
            <p className="text-xs text-muted-foreground">{t("bulkTechnicianHint")}</p>
          </div>
          {technician.trim() && (
            <div className="grid gap-2">
              <Label>{t("secondTechnicianOptional")}</Label>
              <TechnicianCombobox value={technician2} onChange={setTechnician2} includeNotApplicable={false} exclude={technician} />
            </div>
          )}
          <div className="grid gap-2">
            <Label>{t("bulkDate")}</Label>
            <Select value={dateMode} onValueChange={(v) => setDateMode(v as "own" | "fixed")}>
              <SelectTrigger className="w-full" data-testid="bulk-date-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own">{t("bulkDateOwn")}</SelectItem>
                <SelectItem value="fixed">{t("bulkDateFixed")}</SelectItem>
              </SelectContent>
            </Select>
            {dateMode === "fixed" && <Input type="date" min={todayIso()} value={fixedDate} onChange={(e) => setFixedDate(e.target.value)} data-testid="bulk-fixed-date" />}
          </div>
          {missingTechnician.length > 0 && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" data-testid="bulk-missing-technician">
              {t("bulkMissingTechnician", { count: missingTechnician.length })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!!progress} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" disabled={!!progress || creatable.length === 0 || invalidDate} onClick={create} data-testid="bulk-create-confirm">
            {progress ? t("bulkCreating", { done: progress.done, total: progress.total }) : t("bulkCreateConfirm", { count: creatable.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
