"use client"

import { History } from "lucide-react"
import { ActivityLogView } from "@/components/activity/activity-log-view"
import { useActivityLogs } from "@/lib/hooks/use-activity-logs"

export default function ActivityPage() {
  return (
    <ActivityLogView
      title="Admin Activity"
      description="Who changed what, and when — recorded automatically for every admin action."
      icon={History}
      actorLabel="Admin"
      searchPlaceholder="Search by admin or record..."
      emptyMessage="No activity recorded yet."
      useLogs={useActivityLogs}
    />
  )
}
