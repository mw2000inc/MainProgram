"use client"

import * as React from "react"
import { addDays, addMonths, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate, todayIso } from "@/lib/utils"
import type { ScheduleJob, ScheduleJobType } from "@/lib/types"

// One colour per job type, used for the day chips and the legend.
const TYPE_STYLE: Record<ScheduleJobType, string> = {
  filter_change: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  collection: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  repair: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  installation: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  monitoring: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  other: "border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300",
}
const TYPE_ORDER: ScheduleJobType[] = ["filter_change", "collection", "repair", "installation", "monitoring", "other"]
const isDraft = (j: ScheduleJob) => j.status === "pending_approval"

// The Full Schedule's Calendar view: every day of one month (Monday-first
// weeks) with that day's jobs counted by type — automatic Filter Change and
// Collection drafts included, marked as drafts until approved — so an admin
// sees the whole month planned at once. Clicking a day lists its jobs (an
// admin can open one to edit it) and offers "Schedule Job on <date>" for a
// Repair or Installation that just came in. Cancelled jobs are left out.
export function ScheduleMonthCalendar({
  jobs,
  month,
  onMonthChange,
  canEdit,
  onScheduleJob,
  onOpenJob,
}: {
  jobs: ScheduleJob[]
  // "YYYY-MM"
  month: string
  onMonthChange: (month: string) => void
  canEdit: boolean
  onScheduleJob: (date: string) => void
  onOpenJob: (job: ScheduleJob) => void
}) {
  const { t } = useTranslation("schedule")
  const { t: tStatus } = useTranslation("status")
  const today = todayIso()
  const first = parseISO(`${month}-01`)
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null)

  const jobsByDay = React.useMemo(() => {
    const map = new Map<string, ScheduleJob[]>()
    for (const j of jobs) {
      if (j.status === "cancelled") continue
      map.set(j.scheduledDate, [...(map.get(j.scheduledDate) ?? []), j])
    }
    return map
  }, [jobs])

  const days = React.useMemo(() => {
    const out: string[] = []
    const end = endOfWeek(endOfMonth(first), { weekStartsOn: 1 })
    for (let d = startOfWeek(startOfMonth(first), { weekStartsOn: 1 }); d <= end; d = addDays(d, 1)) out.push(format(d, "yyyy-MM-dd"))
    return out
  }, [first])

  const monthJobs = days.filter((d) => d.startsWith(month)).flatMap((d) => jobsByDay.get(d) ?? [])
  const monthDrafts = monthJobs.filter(isDraft).length
  const shift = (n: number) => {
    setSelectedDay(null)
    onMonthChange(format(addMonths(first, n), "yyyy-MM"))
  }
  const selectedJobs = selectedDay ? (jobsByDay.get(selectedDay) ?? []) : []

  return (
    <Card>
      <CardContent className="space-y-4 pt-6" data-testid="schedule-month-calendar">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(-1)} aria-label={t("monthPrevious")} title={t("monthPrevious")}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-40 text-center text-sm font-semibold" data-testid="calendar-month-label">
            {format(first, "MMMM yyyy")}
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shift(1)} aria-label={t("monthNext")} title={t("monthNext")}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="calendar-month-summary">
            {t("calendarMonthSummary", { count: monthJobs.length, drafts: monthDrafts })}
          </span>
          {/* What the chips mean. */}
          <div className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
            {(["filter_change", "collection", "repair", "installation"] as ScheduleJobType[]).map((type) => (
              <span key={type} className={cn("rounded border px-1.5 py-0.5", TYPE_STYLE[type])}>
                {t(type)}
              </span>
            ))}
            <span className="rounded border border-dashed px-1.5 py-0.5 text-muted-foreground">{t("calendarDraftLegend")}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="bg-muted/60 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {format(addDays(startOfWeek(first, { weekStartsOn: 1 }), i), "EEE")}
              </div>
            ))}
            {days.map((day) => {
              const inMonth = day.startsWith(month)
              const dayJobs = jobsByDay.get(day) ?? []
              const weekend = [0, 6].includes(parseISO(day).getDay())
              const byType = TYPE_ORDER.map((type) => {
                const list = dayJobs.filter((j) => j.jobType === type)
                return { type, total: list.length, drafts: list.filter(isDraft).length }
              }).filter((x) => x.total > 0)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                  data-testid="calendar-day"
                  data-date={day}
                  data-count={dayJobs.length}
                  className={cn(
                    "flex min-h-24 flex-col items-stretch gap-1 bg-background p-1.5 text-left transition-colors hover:bg-muted/40",
                    !inMonth && "bg-muted/20 text-muted-foreground",
                    weekend && inMonth && "bg-muted/30",
                    day === selectedDay && "ring-2 ring-primary ring-inset"
                  )}
                >
                  <span className={cn("text-xs font-medium", day === today && "inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground")}>
                    {format(parseISO(day), "d")}
                  </span>
                  {byType.map(({ type, total, drafts }) => (
                    <span
                      key={type}
                      data-testid="calendar-chip"
                      data-type={type}
                      className={cn("truncate rounded border px-1 py-0.5 text-[11px] leading-tight", TYPE_STYLE[type], drafts === total && "border-dashed")}
                      title={t("calendarChipTitle", { type: t(type), total, drafts })}
                    >
                      {t(type)} {total}
                      {drafts > 0 && <span className="opacity-70"> · {t("calendarDraftsShort", { count: drafts })}</span>}
                    </span>
                  ))}
                </button>
              )
            })}
          </div>
        </div>

        {selectedDay && (
          <div className="rounded-lg border" data-testid="calendar-day-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
              <span className="text-sm font-semibold">
                {formatDate(selectedDay, "EEEE, MMM d, yyyy")} · {t("calendarJobsCount", { count: selectedJobs.length })}
              </span>
              {canEdit && (
                <Button size="sm" className="h-8 gap-1.5" onClick={() => onScheduleJob(selectedDay)} data-testid="calendar-schedule-job">
                  <Plus className="h-3.5 w-3.5" /> {t("calendarScheduleOn", { date: formatDate(selectedDay, "MMM d") })}
                </Button>
              )}
            </div>
            {selectedJobs.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("calendarNoJobs")}</p>
            ) : (
              <ul className="divide-y">
                {selectedJobs
                  .slice()
                  .sort((a, b) => TYPE_ORDER.indexOf(a.jobType) - TYPE_ORDER.indexOf(b.jobType) || (a.orderNo ?? "").localeCompare(b.orderNo ?? ""))
                  .map((job) => (
                    <li key={job.id}>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => onOpenJob(job)}
                        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
                        data-testid="calendar-day-job"
                      >
                        <span className={cn("rounded border px-1.5 py-0.5 text-[11px]", TYPE_STYLE[job.jobType], isDraft(job) && "border-dashed")}>{t(job.jobType)}</span>
                        <span className="font-medium">{job.orderNo || "—"}</span>
                        <span className="text-muted-foreground">{job.technician ? formatTechnicians(job.technician, job.technician2) : t("unassigned")}</span>
                        {job.vehicle && <span className="text-muted-foreground">· {job.vehicle}</span>}
                        <Badge variant="outline" className="ml-auto text-[11px]">
                          {isDraft(job) ? t("calendarDraftLegend") : tStatus(job.status)}
                        </Badge>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
