"use client"

import Link from "next/link"
import { Banknote, ExternalLink, Filter, Package, Wrench } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ServiceEvent, ServiceEventKind } from "@/lib/service-history"

const ICON: Record<ServiceEventKind, typeof Wrench> = {
  installation: Package,
  filter_change: Filter,
  repair: Wrench,
  collection: Banknote,
}
const TONE: Record<ServiceEventKind, string> = {
  installation: "bg-primary/10 text-primary",
  filter_change: "bg-success/10 text-success",
  repair: "bg-warning/10 text-warning",
  collection: "bg-muted text-muted-foreground",
}
const LABEL: Record<ServiceEventKind, string> = {
  installation: "serviceInstallation",
  filter_change: "serviceFilterChange",
  repair: "serviceRepair",
  collection: "serviceCollection",
}

// The Service History list shared by the member page and the public QR-scan
// portal (see buildServiceTimeline) — newest first, one row per record.
export function ServiceTimeline({ events, loading }: { events: ServiceEvent[]; loading?: boolean }) {
  const { t } = useTranslation("member")
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }
  if (events.length === 0) return <p className="text-sm text-muted-foreground">{t("noServiceVisits")}</p>
  return (
    <div className="space-y-4">
      {events.map((event) => {
        const Icon = ICON[event.kind]
        return (
          <div key={event.key} data-testid="service-event" data-kind={event.kind} className="flex gap-3 border-b pb-4 last:border-0 last:pb-0">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${TONE[event.kind]}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{t(LABEL[event.kind])}</p>
                <PlanStatusBadge status={event.status} />
                <span className="text-xs text-muted-foreground">{event.orderNo}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDate(event.date)}
                {!event.completed && ` · ${t("servicePlannedDate")}`}
                {event.technician && event.technician !== "N/A" && ` · ${formatTechnicians(event.technician, event.technician2, "&")}`}
              </p>
              {event.details.map(([label, value]) => (
                <p key={label} className="mt-1 text-sm wrap-break-word">
                  <span className="text-muted-foreground">{t(label)}:</span> {value}
                </p>
              ))}
            </div>
            {event.href && (
              <Link href={event.href} className="shrink-0 self-start text-muted-foreground hover:text-primary" title={t("serviceOpenRecord")} aria-label={t("serviceOpenRecord")}>
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}
