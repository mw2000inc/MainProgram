"use client"

import * as React from "react"
import { CalendarDays } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn, formatDate } from "@/lib/utils"

// Compact replacement for the old full-card Date panel — same
// button-that-opens-a-popover-calendar pattern as ActivityDateFilter, just
// always holding a value (the Daily Report always has a date selected;
// there's no "no filter" state here). Lives in the Daily Report's toolbar,
// always visible — a technician needs to change the report date same as an
// admin — right next to the admin-only Pending Dispatch Approval button.
export function DailyReportDateButton({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (date: string) => void
  className?: string
}) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("gap-1.5 font-normal", className)}>
          <CalendarDays className="h-3.5 w-3.5" />
          {formatDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={new Date(`${value}T00:00:00`)}
          onSelect={(date) => {
            if (!date) return
            // Built from the picked date's own local fields, not
            // toISOString() — that shifts to UTC and can land on the wrong
            // calendar day depending on the browser's timezone.
            const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
            onChange(iso)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
