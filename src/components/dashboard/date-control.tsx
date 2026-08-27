"use client"

import { CalendarDays } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useDragHandle } from "@/components/dashboard/sortable-panel"
import { formatDate, cn } from "@/lib/utils"

export function DateControl({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const dragHandle = useDragHandle()

  return (
    <Card className="h-full min-w-0 max-w-full flex flex-col">
      <CardHeader
        {...dragHandle}
        className={cn("min-w-0 max-w-full pb-2", dragHandle && "touch-none cursor-grab select-none active:cursor-grabbing")}
      >
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">Date</span>
        </CardTitle>
      </CardHeader>
      {/* flex-1 + justify-center: when this panel is resized taller than its
          natural content, the date readout + input center in the extra
          space instead of staying pinned under the header with a dead gap
          below. At natural size there's no extra space to distribute, so
          this has no visible effect there. */}
      <CardContent className="min-w-0 max-w-full flex-1 flex flex-col justify-center space-y-2">
        {/* Compact — day name + date, not a big calendar block. The native
            date input right below is the actual picker; this is just the
            at-a-glance readout, e.g. "WEDNESDAY" / "26 AUGUST 2026". */}
        <div className="leading-tight">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">{formatDate(value, "EEEE")}</p>
          <p className="text-lg font-semibold uppercase">{formatDate(value, "d MMMM yyyy")}</p>
        </div>
        <Input
          id="daily-report-date"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full max-w-xs min-w-0"
        />
      </CardContent>
    </Card>
  )
}
