"use client"

import * as React from "react"
import { TechnicianActivityHistoryDialog } from "@/components/schedule/technician-activity-history-dialog"
import { useTechnicianWorkloadIndex } from "@/lib/hooks/use-technician-workload"
import { ALL_TECHNICIANS, workloadFor, workloadPeriodLabels, type WorkloadPeriod } from "@/lib/technician-workload"
import { useTranslation } from "@/lib/i18n/i18n-context"

// Schedule toolbar: this week's and this month's jobs done / assigned, for the
// technician picked in the filter next to it, or the whole team for "all".
// Each badge opens the jobs behind it (TechnicianActivityHistoryDialog).
export function TechnicianWorkloadStats({ technician }: { technician: string }) {
  const { t } = useTranslation("schedule")
  const index = useTechnicianWorkloadIndex()
  const [historyPeriod, setHistoryPeriod] = React.useState<WorkloadPeriod | null>(null)
  const isAll = technician === "all"
  const c = workloadFor(index, isAll ? ALL_TECHNICIANS : technician)
  const periods = workloadPeriodLabels()
  const title = t("workloadBarTooltip", {
    who: isAll ? t("allTechnicians") : technician,
    week: periods.week,
    month: periods.month,
  })
  const badge = (period: WorkloadPeriod, label: string, done: number, assigned: number) => (
    <button
      type="button"
      data-testid={`workload-${period}`}
      onClick={() => setHistoryPeriod(period)}
      className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{t("workloadDoneAssigned", { done: String(done), assigned: String(assigned) })}</span>
    </button>
  )
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="toolbar-workload" title={title}>
        {badge("week", t("workloadThisWeek"), c.weekCompleted, c.weekAssigned)}
        {badge("month", t("workloadThisMonth"), c.monthCompleted, c.monthAssigned)}
      </div>
      <TechnicianActivityHistoryDialog
        open={historyPeriod !== null}
        onOpenChange={(open) => !open && setHistoryPeriod(null)}
        technician={technician}
        period={historyPeriod ?? "week"}
        onPeriodChange={setHistoryPeriod}
      />
    </>
  )
}
