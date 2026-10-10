"use client"

import * as React from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

// "All months" or one month ("YYYY-MM") for the Schedule list: a button with
// prev/next-month arrows, opening a month calendar (one year, 3×4 months).
// Months that have jobs are marked with a dot.
export function ScheduleMonthPicker({
  value,
  onChange,
  monthsWithJobs,
}: {
  value: string
  onChange: (month: string) => void
  monthsWithJobs: Set<string>
}) {
  const { t, locale } = useTranslation("schedule")
  const [open, setOpen] = React.useState(false)
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [year, setYear] = React.useState(() => Number((value === "all" ? thisMonth : value).slice(0, 4)))
  const monthLabel = (ym: string, style: "long" | "short" = "long") =>
    new Date(`${ym}-01T00:00:00`).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US", { month: style, ...(style === "long" ? { year: "numeric" } : {}) })
  const step = (by: number) => {
    const [y, m] = (value === "all" ? thisMonth : value).split("-").map(Number)
    const d = new Date(Date.UTC(y, m - 1 + by, 1))
    onChange(d.toISOString().slice(0, 7))
  }

  return (
    <div className="flex items-center gap-1" data-testid="schedule-month-picker">
      <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => step(-1)} aria-label={t("monthPrevious")}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setYear(Number((value === "all" ? thisMonth : value).slice(0, 4)))
        }}
      >
        <PopoverTrigger asChild>
          <Button type="button" variant={value === "all" ? "outline" : "default"} className="h-9 min-w-40 gap-1.5" data-testid="schedule-month-button">
            <CalendarDays className="h-4 w-4" />
            {value === "all" ? t("allMonths") : monthLabel(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <div className="mb-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setYear((y) => y - 1)} aria-label={t("yearPrevious")}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold" data-testid="schedule-month-year">
              {year}
            </span>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setYear((y) => y + 1)} aria-label={t("yearNext")}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, i) => {
              const ym = `${year}-${String(i + 1).padStart(2, "0")}`
              const selected = ym === value
              return (
                <button
                  key={ym}
                  type="button"
                  onClick={() => {
                    onChange(ym)
                    setOpen(false)
                  }}
                  className={cn(
                    "relative rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                    selected && "bg-primary text-primary-foreground hover:bg-primary",
                    ym === thisMonth && !selected && "ring-1 ring-primary/50"
                  )}
                  data-testid="schedule-month-option"
                  data-month={ym}
                >
                  {monthLabel(ym, "short")}
                  {monthsWithJobs.has(ym) && (
                    <span className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} />
                  )}
                </button>
              )
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              onChange("all")
              setOpen(false)
            }}
            data-testid="schedule-month-all"
          >
            {t("allMonths")}
          </Button>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => step(1)} aria-label={t("monthNext")}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}
