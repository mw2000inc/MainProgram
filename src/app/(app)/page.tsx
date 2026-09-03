"use client"

import { ClipboardList } from "lucide-react"
import { DailyReportSection } from "@/components/dashboard/daily-report-section"
import { useTranslation } from "@/lib/i18n/i18n-context"

export default function DailyReportPage() {
  const { t: tNav } = useTranslation("nav")
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-primary" /> {tNav("dailyReport")}
        </h1>
        <p className="text-sm text-muted-foreground">{tNav("dailyReportDescription")}</p>
      </div>

      <DailyReportSection />
    </div>
  )
}
