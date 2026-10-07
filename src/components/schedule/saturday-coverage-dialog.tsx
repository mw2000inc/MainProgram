"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SaturdayErrandDialog } from "@/components/schedule/saturday-errand-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { updateScheduleJob } from "@/lib/api/schedule"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { VEHICLE_CREWS } from "@/lib/constants"
import { crewOfTechnician, isAssignedTechnician, technicianAccountIds, type TechnicianAccount } from "@/lib/technicians"
import { createJobsFromVisits } from "@/lib/scheduling/create-jobs-from-visits"
import { distributeByArea } from "@/lib/scheduling/location-clusters"
import { fieldTechnicianNames } from "@/lib/scheduling/dispatch-assignment"
import { formatDate } from "@/lib/utils"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import type { ScheduleJob } from "@/lib/types"

const UNASSIGNED = "__unassigned"

// Who goes out together that Saturday: each ticked technician on their own,
// except a fixed crew whose members are BOTH ticked (Eubert + Jayson → one
// team with the Liteace). A crew member ticked alone goes alone, no vehicle.
interface Team {
  key: string
  label: string
  primary: string
  secondary: string
  vehicle: string
}

type Row = { key: string; kind: "job"; job: ScheduleJob; label: string; address?: string } | { key: string; kind: "visit"; visit: UnscheduledVisit; label: string; address?: string }

function teamsFor(working: string[]): Team[] {
  const teams: Team[] = []
  const used = new Set<string>()
  for (const name of working) {
    if (used.has(name)) continue
    const crew = crewOfTechnician(name)
    const partner = crew && [crew.primary, crew.secondary].find((m) => m.toLowerCase() !== name.toLowerCase())
    const partnerWorking = partner && working.find((w) => w.toLowerCase() === partner.toLowerCase())
    if (crew && partnerWorking) {
      used.add(name)
      used.add(partnerWorking)
      teams.push({ key: crew.vehicle, label: `${crew.primary} & ${crew.secondary} (${crew.vehicle})`, primary: crew.primary, secondary: crew.secondary, vehicle: crew.vehicle })
    } else {
      used.add(name)
      teams.push({ key: name, label: name, primary: name, secondary: "", vehicle: "" })
    }
  }
  return teams
}

// "Assign Saturday Coverage": Saturday is never auto-assigned, so an admin
// first ticks who is working that Saturday, then each Saturday job / visit
// gets one of those teams — pre-filled by splitting the queue by area across
// the teams (neighbouring areas stay together), changeable per row. Confirming
// sets each assigned job's technicians, logins and vehicle and makes it
// active; a visit without a job gets one, active. Rows left Unassigned are
// untouched.
export function SaturdayCoverageDialog({
  open,
  onOpenChange,
  saturday,
  jobs,
  visits,
  accounts,
  addressOfJob,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  saturday: string
  jobs: ScheduleJob[]
  visits: UnscheduledVisit[]
  accounts: TechnicianAccount[]
  addressOfJob: (job: ScheduleJob) => string | undefined
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const qc = useQueryClient()
  const technicians = React.useMemo(() => fieldTechnicianNames(accounts), [accounts])
  const [working, setWorking] = React.useState<string[]>([])
  const [choice, setChoice] = React.useState<Record<string, string>>({})
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  // "+ Add Errand" opens the errand form for this Saturday on top of this
  // dialog; on save it refreshes the schedule, so the errand joins the list
  // below right away (unassigned) or lands on its technician's Saturday.
  const [errandOpen, setErrandOpen] = React.useState(false)

  const rows = React.useMemo<Row[]>(
    () => [
      // An errand (type "other") has no order number; its description is in notes.
      ...jobs.map((job): Row => ({
        key: `job:${job.id}`,
        kind: "job",
        job,
        label: job.orderNo || (job.jobType === "other" && job.notes?.trim() ? job.notes.trim() : t(job.jobType)),
        address: addressOfJob(job),
      })),
      ...visits.map((visit): Row => ({ key: `visit:${visit.key}`, kind: "visit", visit, label: visit.orderNo, address: visit.address })),
    ],
    [jobs, visits, addressOfJob, t]
  )
  const teams = React.useMemo(() => teamsFor(working), [working])
  const teamByKey = React.useMemo(() => new Map(teams.map((tm) => [tm.key, tm])), [teams])

  // Ticking technicians re-splits the queue across the teams by area.
  const toggle = (name: string) => {
    const next = working.includes(name) ? working.filter((w) => w !== name) : [...working, name]
    setWorking(next)
    const nextTeams = teamsFor(next)
    if (nextTeams.length === 0) {
      setChoice({})
      return
    }
    const plan = distributeByArea(rows, (r) => r.address, nextTeams.map((tm) => tm.key))
    const auto: Record<string, string> = {}
    for (const { day: teamKey, clusters } of plan) for (const r of clusters.flatMap((c) => c.items)) auto[r.key] = teamKey
    setChoice(auto)
  }

  const assigned = rows.filter((r) => choice[r.key] && choice[r.key] !== UNASSIGNED && teamByKey.has(choice[r.key]))

  async function confirm() {
    setProgress({ done: 0, total: assigned.length })
    let done = 0
    const failed: string[] = []
    for (const row of assigned) {
      const team = teamByKey.get(choice[row.key])!
      const ids = technicianAccountIds(team.primary, team.secondary, accounts)
      try {
        if (row.kind === "job") {
          await updateScheduleJob(row.job.id, {
            technician: team.primary,
            technician2: team.secondary,
            technicianUserId: ids.technicianUserId,
            technician2UserId: ids.technician2UserId,
            vehicle: team.vehicle,
            status: "pending",
          })
        } else {
          const result = await createJobsFromVisits([row.visit], {
            dateFor: () => saturday,
            assignFor: () => ({ pair: { primary: team.primary, secondary: team.secondary }, vehicle: team.vehicle }),
            accounts,
            activate: true,
          })
          if (result.failed.length) throw new Error(result.failed[0])
        }
      } catch (error) {
        failed.push(`${row.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
      done += 1
      setProgress((p) => (p ? { ...p, done } : p))
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setProgress(null)
    const ok = assigned.length - failed.length
    if (ok) toast.success(t("coverageDone", { count: ok, date: formatDate(saturday) }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
    onOpenChange(false)
  }

  const crewNote = Object.entries(VEHICLE_CREWS)
    .map(([vehicle, crew]) => (crew ? t("coverageCrewNote", { crew: `${crew[0]} & ${crew[1]}`, vehicle }) : ""))
    .filter(Boolean)
    .join(" ")

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => !progress && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        data-testid="saturday-coverage"
        // The errand form (and its dropdowns) open on top of this dialog as
        // React-tree siblings, so a press inside them counts as "outside"
        // here — same guard as the expanded Daily Report panels: a press
        // that started inside another dialog or a dropdown list never
        // dismisses this one.
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [data-slot="popover-content"]')) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [data-slot="popover-content"]')) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("coverageTitle", { date: formatDate(saturday) })}</DialogTitle>
          <DialogDescription>{t("coverageDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{t("coverageWhoIsWorking")}</p>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-xs" disabled={!!progress} onClick={() => setErrandOpen(true)} data-testid="coverage-add-errand">
                <Plus className="h-3.5 w-3.5" /> {t("errandAdd")}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {technicians.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Checkbox checked={working.includes(name)} onCheckedChange={() => toggle(name)} data-testid="coverage-technician" aria-label={name} />
                  {name}
                </label>
              ))}
            </div>
            {crewNote && <p className="mt-2 text-xs text-muted-foreground">{crewNote}</p>}
          </div>
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("coverageNothing")}</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("tableCustomerOrder")}</th>
                    <th className="px-3 py-2 font-medium">{t("tableAddress")}</th>
                    <th className="w-60 px-3 py-2 font-medium">{t("tableTechnician")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t align-top" data-testid="coverage-row">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{row.label}</div>
                        <div className="text-xs text-muted-foreground">{row.kind === "job" ? (row.job.jobType === "other" ? t("errandBadge") : t(row.job.jobType)) : t(row.visit.jobType)}</div>
                      </td>
                      <td className="max-w-[16rem] px-3 py-1.5 text-xs">{row.address || "—"}</td>
                      <td className="px-3 py-1.5">
                        <Select
                          value={choice[row.key] && teamByKey.has(choice[row.key]) ? choice[row.key] : UNASSIGNED}
                          onValueChange={(v) => setChoice((c) => ({ ...c, [row.key]: v }))}
                          disabled={teams.length === 0}
                        >
                          <SelectTrigger size="sm" className="h-8 w-full text-xs" data-testid="coverage-row-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED}>{t("unassigned")}</SelectItem>
                            {teams.map((tm) => (
                              <SelectItem key={tm.key} value={tm.key}>
                                {tm.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {row.kind === "job" && isAssignedTechnician(row.job.technician) && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("coverageCurrently", { name: row.job.technician })}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!!progress} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" disabled={!!progress || assigned.length === 0} onClick={confirm} data-testid="coverage-confirm">
            {progress ? t("coverageProgress", { done: progress.done, total: progress.total }) : t("coverageConfirm", { count: assigned.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <SaturdayErrandDialog open={errandOpen} onOpenChange={setErrandOpen} defaultDate={saturday} />
    </>
  )
}
