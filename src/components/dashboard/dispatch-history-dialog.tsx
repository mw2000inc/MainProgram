"use client"

import * as React from "react"
import { Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useUsers } from "@/lib/hooks/use-misc"
import { useDispatchNotifications } from "@/lib/hooks/use-dispatch-confirmation"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { DispatchEntityType, DispatchNotificationRecord } from "@/lib/api/dispatch-confirmation"
import type { DispatchStatus } from "@/lib/types"

// Same mapping as DispatchStatusCell/DispatchApprovalQueue's own copies —
// kept as its own small copy here too rather than a shared import, same
// reasoning as those two: avoids a cross-import between otherwise-
// independent panel files for four lines that essentially never change.
const DISPATCH_STATUS_KEYS: Record<string, string> = {
  Draft: "draft",
  "Pending Customer Confirmation": "pendingCustomerConfirmation",
  Confirmed: "confirmed",
  "Reschedule Requested": "rescheduleRequested",
}

interface RecordInfo {
  moduleLabel: string
  recordLabel: string
  scheduledDate: string
  dispatchStatus?: DispatchStatus
}

// A notification "event" — every dispatch_notifications row for the same
// entity within a few seconds of each other, grouped together. Neither
// extreme fits: showing every raw channel row separately would split one
// approval's SMS and email into two disconnected lines, but collapsing
// each entity down to just its latest send would silently hide an earlier
// failed attempt (or an entirely separate later reschedule-acceptance) —
// this table has no column distinguishing "which approval action" a row
// belongs to, so timing proximity is what stands in for it. The two
// channels of one real approve/accept-reschedule call are always inserted
// back-to-back in the same request, well under this window; two genuinely
// separate actions on the same record (e.g. approved, then reschedule-
// accepted days later) are always far enough apart to land as separate
// events.
const GROUP_WINDOW_MS = 5000

interface HistoryEvent {
  key: string
  entityType: DispatchEntityType
  entityId: string
  createdAt: string
  createdBy?: string
  sms?: DispatchNotificationRecord
  email?: DispatchNotificationRecord
}

function groupIntoEvents(rows: DispatchNotificationRecord[]): HistoryEvent[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const events: HistoryEvent[] = []
  for (const row of sorted) {
    const openEvent = events.find(
      (e) =>
        e.entityType === row.entityType &&
        e.entityId === row.entityId &&
        Math.abs(new Date(row.createdAt).getTime() - new Date(e.createdAt).getTime()) <= GROUP_WINDOW_MS &&
        (row.channel === "sms" ? !e.sms : !e.email)
    )
    if (openEvent) {
      if (row.channel === "sms") openEvent.sms = row
      else openEvent.email = row
    } else {
      events.push({
        key: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        sms: row.channel === "sms" ? row : undefined,
        email: row.channel === "email" ? row : undefined,
      })
    }
  }
  return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// Admin approval/reschedule history — every past send this app has
// actually attempted, across all four dispatch-eligible modules. Built on
// dispatch_notifications (the only place per-channel SMS/email delivery
// status actually lives — see the investigation this was scoped from,
// Activity Log has the same events buried in ~100x more unrelated field
// edits). Read-only and deliberately separate from DispatchApprovalQueue —
// that dialog's own empty state is "nothing is waiting," which a growing
// historical list would muddy.
export function DispatchHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: users = [] } = useUsers()
  const { data: notifications = [], isPending } = useDispatchNotifications()
  const [search, setSearch] = React.useState("")

  // Current record label/module/status per entity — deliberately its own
  // small lookup rather than reusing DispatchApprovalQueue's own allRows
  // (which also resolves phone/email/customer-conflict data this read-only
  // view has no use for) — same field mappings, just the subset history
  // actually needs.
  const recordIndex = React.useMemo(() => {
    const map = new Map<string, RecordInfo>()
    for (const p of filterChangePlans) {
      map.set(`filter_change_plans:${p.id}`, {
        moduleLabel: "filterChangeModule",
        recordLabel: p.memberAccount || p.orderNumber,
        scheduledDate: p.preD || p.planDate,
        dispatchStatus: p.dispatchStatus,
      })
    }
    for (const p of installPlans) {
      map.set(`install_plans:${p.id}`, {
        moduleLabel: "installationModule",
        recordLabel: p.name || p.orderNo,
        scheduledDate: p.preInstalledDate || p.inputDate,
        dispatchStatus: p.dispatchStatus,
      })
    }
    for (const c of collections) {
      map.set(`collections:${c.id}`, {
        moduleLabel: "collectionModule",
        recordLabel: c.accountName || c.orderNo,
        scheduledDate: c.preD || c.collectionDate,
        dispatchStatus: c.dispatchStatus,
      })
    }
    for (const r of repairPlans) {
      map.set(`repair_plans:${r.id}`, {
        moduleLabel: "repairModule",
        recordLabel: r.accountName || r.orderNo,
        scheduledDate: r.preD || r.issuedDate,
        dispatchStatus: r.dispatchStatus,
      })
    }
    return map
  }, [filterChangePlans, installPlans, collections, repairPlans])

  const userNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  const events = React.useMemo(() => groupIntoEvents(notifications), [notifications])

  const filteredEvents = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return events
    return events.filter((e) => {
      const info = recordIndex.get(`${e.entityType}:${e.entityId}`)
      const moduleText = info ? t(info.moduleLabel) : ""
      return (info?.recordLabel ?? "").toLowerCase().includes(q) || moduleText.toLowerCase().includes(q)
    })
  }, [events, recordIndex, search, t])

  function channelBadge(result: DispatchNotificationRecord | undefined, channel: "sms" | "email") {
    if (!result) return null
    const tone = result.status === "sent" ? "success" : result.status === "failed" ? "danger" : "neutral"
    const key = `${channel}${result.status === "sent" ? "Sent" : result.status === "failed" ? "Failed" : "Skipped"}`
    return <StatusBadge tone={tone} label={t(key)} />
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("historyTitle")}</DialogTitle>
          <DialogDescription>{t("historyDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder={t("historySearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isPending ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
        ) : filteredEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {events.length === 0 ? t("noHistoryYet") : t("noHistoryMatches")}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredEvents.map((event) => {
              const info = recordIndex.get(`${event.entityType}:${event.entityId}`)
              const approverName = event.createdBy ? userNameById.get(event.createdBy) : undefined
              return (
                <div key={event.key} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="secondary" label={info ? t(info.moduleLabel) : t("unknown")} />
                        <span className="font-medium truncate">{info?.recordLabel ?? t("recordNoLongerAvailable")}</span>
                        {info?.dispatchStatus && (
                          <StatusBadge
                            tone={info.dispatchStatus === "Confirmed" ? "success" : info.dispatchStatus === "Draft" ? "neutral" : "warning"}
                            label={t(DISPATCH_STATUS_KEYS[info.dispatchStatus] ?? info.dispatchStatus)}
                          />
                        )}
                      </div>
                      {info?.scheduledDate && (
                        <p className="text-xs text-muted-foreground">{t("scheduled", { date: formatDate(info.scheduledDate) })}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {channelBadge(event.sms, "sms")}
                      {channelBadge(event.email, "email")}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("approvedBy", { name: approverName ?? t("unknown") })} · {formatDateTime(event.createdAt)}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
