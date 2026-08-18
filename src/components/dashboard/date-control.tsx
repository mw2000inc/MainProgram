"use client"

import { CalendarDays } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function DateControl({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader className="min-w-0 max-w-full pb-2">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">Date</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 max-w-full">
        <Label htmlFor="daily-report-date" className="text-xs text-muted-foreground">
          Date
        </Label>
        <Input
          id="daily-report-date"
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full max-w-xs min-w-0"
        />
      </CardContent>
    </Card>
  )
}
