"use client"

import * as React from "react"
import { CalendarIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"

// Compact single-day filter shared by the Admin Activity and Technician
// Activity pages — narrows the list to one calendar day (in UTC, matching
// how activity_logs.created_at and every other stored date in this app is
// treated) instead of scrolling through one long combined list. value/
// onChange use the same yyyy-MM-dd string format as the rest of the app
// (see DateControl); undefined means "no filter, show everything".
export function ActivityDateFilter({
  value,
  onChange,
}: {
  value: string | undefined
  onChange: (date: string | undefined) => void
}) {
  const [open, setOpen] = React.useState(false)
  const { t } = useTranslation("activity")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-1.5 font-normal", !value && "text-muted-foreground")}>
          <CalendarIcon className="h-3.5 w-3.5" />
          {value ? formatDate(value) : t("allDates")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={value ? new Date(`${value}T00:00:00`) : undefined}
          onSelect={(date) => {
            if (!date) return
            const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
            onChange(iso)
            setOpen(false)
          }}
        />
        {value && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-1.5"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" /> {t("clearFilter")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
