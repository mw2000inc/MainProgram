"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { CalendarRange } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { SCHEDULE_TIMEFRAME_LABEL, type ScheduleTimeframe } from "@/lib/schedule-timeframe"
import { formatDate, todayIso } from "@/lib/utils"

// What the Schedule widget shows: a preset anchored on the Daily Report's
// date (moves with it), or dates picked on the calendar (fixed).
export type ScheduleDateSelection = ScheduleTimeframe | { start: string; end: string }

const PRESETS: ScheduleTimeframe[] = ["day", "thisWeek", "thisMonth"]

// "Oct 5, 2026", "Oct 5 – Oct 12, 2026", or "Dec 28, 2026 – Jan 3, 2027".
export function formatScheduleRange(range: { start: string; end: string }): string {
  if (range.start === range.end) return formatDate(range.start)
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4)
  return sameYear ? `${formatDate(range.start, "MMM d")} – ${formatDate(range.end)}` : `${formatDate(range.start)} – ${formatDate(range.end)}`
}

// The Schedule widget's date filter: a popover with preset chips and a
// calendar. One click picks a single day (applied at once, popover stays
// open); a second click makes it a start–end range and closes the popover.
export function ScheduleDateRangePicker({
  selection,
  range,
  anchor,
  onChange,
}: {
  selection: ScheduleDateSelection
  range: { start: string; end: string }
  anchor: string
  onChange: (selection: ScheduleDateSelection) => void
}) {
  const { t } = useTranslation("schedule")
  const [open, setOpen] = React.useState(false)
  const [viewMonth, setViewMonth] = React.useState(() => parseISO(range.start))
  // The first click of a pick, waiting for an end date.
  const [pendingFrom, setPendingFrom] = React.useState<Date | undefined>(undefined)

  const handleOpenChange = (next: boolean) => {
    if (next) setViewMonth(parseISO(range.start))
    setPendingFrom(undefined)
    setOpen(next)
  }
  const iso = (d: Date) => format(d, "yyyy-MM-dd")
  const presetLabel = (p: ScheduleTimeframe) => (p === "day" && anchor !== todayIso() ? formatDate(anchor) : t(SCHEDULE_TIMEFRAME_LABEL[p]))

  const pickDay = (day: Date) => {
    if (!pendingFrom) {
      setPendingFrom(day)
      onChange({ start: iso(day), end: iso(day) })
      return
    }
    const [from, to] = day < pendingFrom ? [day, pendingFrom] : [pendingFrom, day]
    onChange({ start: iso(from), end: iso(to) })
    setPendingFrom(undefined)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t("timeframe")}
          data-testid="schedule-timeframe"
          className="h-8 gap-1.5 text-xs font-normal @xs/card-header:flex-1 @sm/card-header:w-auto @sm/card-header:flex-none"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          {formatScheduleRange(range)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap gap-1.5 border-b p-2" data-testid="schedule-timeframe-presets">
          {PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={selection === p ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => {
                onChange(p)
                setPendingFrom(undefined)
                setOpen(false)
              }}
            >
              {presetLabel(p)}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          weekStartsOn={1}
          selected={pendingFrom ? { from: pendingFrom, to: pendingFrom } : { from: parseISO(range.start), to: parseISO(range.end) }}
          month={viewMonth}
          onMonthChange={setViewMonth}
          onDayClick={pickDay}
          // Selection is driven by onDayClick (react-day-picker's own range
          // logic would extend the existing range instead of starting anew).
          onSelect={() => {}}
        />
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">{t(pendingFrom ? "timeframePickEnd" : "timeframePickHint")}</p>
      </PopoverContent>
    </Popover>
  )
}
