"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { rescheduleVisit, updateScheduleJob } from "@/lib/api/schedule"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { filterChangePlansKey } from "@/lib/hooks/use-filter-change-plans"
import { installPlansKey } from "@/lib/hooks/use-install-plans"
import { repairPlansKey } from "@/lib/hooks/use-repair-plans"
import { collectionsKey } from "@/lib/hooks/use-collections"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { businessDaysAfterSaturday } from "@/lib/schedule-timeframe"
import { distributeByArea } from "@/lib/scheduling/location-clusters"
import { formatDate } from "@/lib/utils"
import type { UnscheduledVisit } from "@/lib/scheduling/unscheduled-visits"
import type { ScheduleJob } from "@/lib/types"

type QueueItem = { kind: "job"; job: ScheduleJob; address?: string; label: string } | { kind: "visit"; visit: UnscheduledVisit; address?: string; label: string }

// "Cancel & Auto-Distribute Saturday Queue": every open job and unscheduled
// visit on a Saturday is moved to the Monday–Wednesday after it, grouped by
// area (read from the address — see location-clusters) so each day covers
// one zone. Shows the plan first; applying it re-dates each job (its linked
// visit follows through the database sync) or each visit's planned date, and
// marks them "Rescheduled from Saturday". A moved job no longer needs the
// Saturday coverage approval, so it becomes active.
export function SaturdayRedistributeDialog({
  open,
  onOpenChange,
  saturday,
  jobs,
  visits,
  addressOfJob,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  saturday: string
  jobs: ScheduleJob[]
  visits: UnscheduledVisit[]
  addressOfJob: (job: ScheduleJob) => string | undefined
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const qc = useQueryClient()
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)

  const days = React.useMemo(() => businessDaysAfterSaturday(saturday), [saturday])
  const plan = React.useMemo(() => {
    const items: QueueItem[] = [
      ...jobs.map((job): QueueItem => ({ kind: "job", job, address: addressOfJob(job), label: job.orderNo || t(job.jobType) })),
      ...visits.map((visit): QueueItem => ({ kind: "visit", visit, address: visit.address, label: visit.orderNo })),
    ]
    return distributeByArea(items, (i) => i.address, days)
  }, [jobs, visits, addressOfJob, days, t])
  const total = jobs.length + visits.length

  async function apply() {
    setProgress({ done: 0, total })
    let moved = 0
    const failed: string[] = []
    for (const { day, clusters } of plan) {
      for (const item of clusters.flatMap((c) => c.items)) {
        try {
          if (item.kind === "job") {
            await updateScheduleJob(item.job.id, {
              scheduledDate: day,
              rescheduledFrom: saturday,
              ...(item.job.status === "pending_approval" ? { status: "pending" as const } : {}),
            })
          } else {
            await rescheduleVisit(item.visit.table, item.visit.recordId, day, saturday)
          }
          moved += 1
        } catch (error) {
          failed.push(`${item.label}: ${error instanceof Error ? error.message : String(error)}`)
        }
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
      }
    }
    for (const queryKey of [scheduleJobsKey, filterChangePlansKey, installPlansKey, repairPlansKey, collectionsKey]) qc.invalidateQueries({ queryKey })
    setProgress(null)
    if (moved) toast.success(t("redistributeDone", { count: moved }))
    if (failed.length) toast.error(t("bulkFailed", { count: failed.length, details: failed.slice(0, 3).join("; ") }))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !progress && onOpenChange(o)}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden" data-testid="saturday-redistribute">
        <DialogHeader>
          <DialogTitle>{t("redistributeTitle", { date: formatDate(saturday) })}</DialogTitle>
          <DialogDescription>{t("redistributeDescription", { count: total })}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {total === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("redistributeNothing")}</p>
          ) : (
            <div className="space-y-3">
              {plan.map(({ day, clusters, count }) => (
                <div key={day} className="rounded-md border p-3" data-testid="redistribute-day">
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">
                    <span>{formatDate(day)}</span>
                    <span className="text-muted-foreground">{t("redistributeDayCount", { count })}</span>
                  </div>
                  {clusters.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">{t("redistributeDayEmpty")}</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-xs">
                      {clusters.map((c) => (
                        <li key={c.area}>
                          <span className="font-medium">{c.area}</span>{" "}
                          <span className="text-muted-foreground">
                            ({c.items.length}) — {c.items.map((i) => i.label).join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={!!progress} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" variant="destructive" disabled={!!progress || total === 0} onClick={apply} data-testid="redistribute-confirm">
            {progress ? t("redistributeProgress", { done: progress.done, total: progress.total }) : t("redistributeConfirm", { count: total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
