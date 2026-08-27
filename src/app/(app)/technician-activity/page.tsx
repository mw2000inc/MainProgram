"use client"

import { Hammer } from "lucide-react"
import { ActivityLogView } from "@/components/activity/activity-log-view"
import { useTechnicianActivityLogs } from "@/lib/hooks/use-activity-logs"

export default function TechnicianActivityPage() {
  return (
    <ActivityLogView
      title="Technician Activity"
      description="Job status changes made by technicians in the field, and when."
      icon={Hammer}
      actorLabel="Technician"
      searchPlaceholder="Search by technician or job..."
      emptyMessage="No technician activity recorded yet."
      useLogs={useTechnicianActivityLogs}
    />
  )
}
