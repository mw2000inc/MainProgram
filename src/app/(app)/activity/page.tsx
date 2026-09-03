"use client"

import { History } from "lucide-react"
import { ActivityLogView } from "@/components/activity/activity-log-view"
import { useActivityLogs } from "@/lib/hooks/use-activity-logs"
import { useTranslation } from "@/lib/i18n/i18n-context"

export default function ActivityPage() {
  const { t } = useTranslation("nav")
  const { t: tActivity } = useTranslation("activity")
  const { t: tCommon } = useTranslation("common")
  return (
    <ActivityLogView
      title={t("adminActivity")}
      description={tActivity("adminActivityDescription")}
      icon={History}
      actorLabel={tCommon("admin")}
      searchPlaceholder={tActivity("adminSearchPlaceholder")}
      emptyMessage={tActivity("adminEmptyMessage")}
      useLogs={useActivityLogs}
    />
  )
}
