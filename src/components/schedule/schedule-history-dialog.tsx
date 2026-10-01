"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/shared/status-badge"
import { ActivityDetailDialog } from "@/components/activity/activity-detail-dialog"
import { useEntityTypeActivityLogs } from "@/lib/hooks/use-activity-logs"
import { actionLabel, fieldLabel } from "@/lib/activity-log-config"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// Bookkeeping columns every update touches — never worth listing as "changed".
const HIDDEN_FIELDS = new Set(["updated_at", "updated_by", "created_at", "created_by"])

type Scope = "inView" | "all"

// The Schedule widget's History: the audit log of schedule job changes
// (activity_logs, written by the audit trigger on schedule_jobs) — who added,
// changed or deleted a job, when, and which fields changed. Defaults to the
// jobs in the widget's current timeframe; "All changes" covers every job,
// including deleted ones. An entry opens the Activity page's own
// before/after detail. Admin-only, like the activity log itself (RLS).
export function ScheduleHistoryDialog({
  open,
  onOpenChange,
  jobIdsInView,
  rangeLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobIdsInView: string[]
  rangeLabel: string
}) {
  const { t } = useTranslation("schedule")
  const { t: tActivity } = useTranslation("activity")
  const { t: tCommon } = useTranslation("common")
  const { data: entries = [], isPending } = useEntityTypeActivityLogs("schedule_jobs", open)
  const [scope, setScope] = React.useState<Scope>("inView")
  const [search, setSearch] = React.useState("")
  const [detail, setDetail] = React.useState<ActivityLogEntry | undefined>(undefined)

  const inView = React.useMemo(() => new Set(jobIdsInView), [jobIdsInView])
  const changedFields = (e: ActivityLogEntry) =>
    Object.keys(e.newValues)
      .filter((k) => !HIDDEN_FIELDS.has(k))
      .map((k) => fieldLabel(k, tActivity))
  const scoped = React.useMemo(
    () => (scope === "all" ? entries : entries.filter((e) => !!e.entityId && inView.has(e.entityId))),
    [entries, scope, inView]
  )
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter((e) =>
      [e.userName, e.description, actionLabel(e.action, tActivity), ...Object.keys(e.newValues).map((k) => fieldLabel(k, tActivity))]
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
  }, [scoped, search, tActivity])

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" data-testid="schedule-history">
          <DialogHeader>
            <DialogTitle>{t("scheduleHistoryTitle")}</DialogTitle>
            <DialogDescription>{t("scheduleHistoryDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("scheduleHistoryScope")} className="inline-flex rounded-md border p-0.5">
              {(["inView", "all"] as Scope[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                  className={cn(
                    "h-7 rounded px-2.5 text-xs font-medium transition-colors",
                    scope === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {value === "inView" ? t("scheduleHistoryInView", { range: rangeLabel }) : t("scheduleHistoryAll")}
                </button>
              ))}
            </div>
            <div className="relative min-w-48 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8 h-8" placeholder={t("scheduleHistorySearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <DialogBody>
            {isPending ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{tCommon("loading")}</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{scoped.length === 0 ? t("scheduleHistoryEmpty") : t("scheduleHistoryNoMatches")}</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {filtered.map((e) => {
                  const fields = e.action === "update" ? changedFields(e) : []
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        data-testid="schedule-history-entry"
                        onClick={() => setDetail(e)}
                        className="flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <StatusBadge
                          tone={e.action === "insert" ? "success" : e.action === "delete" ? "danger" : "secondary"}
                          label={actionLabel(e.action, tActivity)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{e.description || "—"}</p>
                          {fields.length > 0 && (
                            <p className="truncate text-xs text-muted-foreground">{t("scheduleHistoryChanged", { fields: fields.join(", ") })}</p>
                          )}
                        </div>
                        <div className="shrink-0 text-right text-xs text-muted-foreground">
                          <p className="font-medium text-foreground">{e.userName}</p>
                          <p>{formatDateTime(e.createdAt)}</p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ActivityDetailDialog entry={detail} onOpenChange={(o) => !o && setDetail(undefined)} />
    </>
  )
}
