"use client"

import { Hammer } from "lucide-react"
import { ActivityLogView } from "@/components/activity/activity-log-view"
import { useTechnicianActivityLogs } from "@/lib/hooks/use-activity-logs"
import { useTranslation } from "@/lib/i18n/i18n-context"

export default function TechnicianActivityPage() {
  const { t } = useTranslation("nav")
  const { t: tActivity } = useTranslation("activity")
  const { t: tCommon } = useTranslation("common")
  return (
    <ActivityLogView
      title={t("technicianActivity")}
      description={tActivity("technicianActivityDescription")}
      icon={Hammer}
      actorLabel={tCommon("technician")}
      searchPlaceholder={tActivity("technicianSearchPlaceholder")}
      emptyMessage={tActivity("technicianEmptyMessage")}
      useLogs={useTechnicianActivityLogs}
    />
  )
}
