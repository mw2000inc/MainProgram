"use client"

import * as React from "react"
import { Hammer } from "lucide-react"
import { ActivityLogView } from "@/components/activity/activity-log-view"
import { useTechnicianActivityLogs } from "@/lib/hooks/use-activity-logs"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { ActivityLogEntry } from "@/lib/types"

// The day (Manila) an activity happened on, as YYYY-MM-DD.
const manilaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })

export default function TechnicianActivityPage() {
  const { t } = useTranslation("nav")
  const { t: tActivity } = useTranslation("activity")
  const { t: tCommon } = useTranslation("common")
  // The Vehicle column: the vehicle(s) on that technician's jobs (either of
  // the job's two technicians) on the day of the activity.
  const { data: jobs = [] } = useScheduleJobs()
  const vehiclesByTechDay = React.useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const j of jobs) {
      const vehicle = (j.vehicle ?? "").trim()
      if (!vehicle || j.status === "cancelled") continue
      for (const uid of [j.technicianUserId, j.technician2UserId]) {
        if (!uid) continue
        const key = `${uid}|${j.scheduledDate}`
        map.set(key, (map.get(key) ?? new Set()).add(vehicle))
      }
    }
    return map
  }, [jobs])
  const vehicleOf = React.useCallback(
    (entry: ActivityLogEntry) => (entry.userId ? [...(vehiclesByTechDay.get(`${entry.userId}|${manilaDay(entry.createdAt)}`) ?? [])].join(" / ") : ""),
    [vehiclesByTechDay]
  )
  return (
    <ActivityLogView
      title={t("technicianActivity")}
      description={tActivity("technicianActivityDescription")}
      icon={Hammer}
      actorLabel={tCommon("technician")}
      searchPlaceholder={tActivity("technicianSearchPlaceholder")}
      emptyMessage={tActivity("technicianEmptyMessage")}
      useLogs={useTechnicianActivityLogs}
      vehicleOf={vehicleOf}
    />
  )
}
