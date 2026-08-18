"use client"

import { ClipboardList } from "lucide-react"
import { DailyReportSection } from "@/components/dashboard/daily-report-section"

export default function DailyReportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" /> Daily Report
        </h1>
        <p className="text-sm text-muted-foreground">Announcements, today&apos;s plans, and the technician schedule in one view.</p>
      </div>

      <DailyReportSection />
    </div>
  )
}
