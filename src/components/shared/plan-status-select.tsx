"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { planStatusLabel } from "@/components/shared/status-badge"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

// One shared inline status control for the four Daily Report plan tables
// (Filter Change, Installation, Collection, Repair) — replaces the old
// read-only PlanStatusBadge + separate one-click "quick action" button
// (Mark Filter Changed / Record Payment) with a single interactive Select
// that both shows and changes status in place, admin-only. Colored to match
// PlanStatusBadge's own tone mapping so this reads the same as the
// read-only badge it replaces, just editable.
const TONE_CLASS: Record<string, string> = {
  pending: "text-warning border-warning/30",
  completed: "text-success border-success/30",
  collected: "text-success border-success/30",
  done: "text-success border-success/30",
  active: "text-success border-success/30",
  cancelled: "text-danger border-danger/30",
  canceled: "text-danger border-danger/30",
}

export function PlanStatusSelect({
  status,
  options,
  onChange,
  disabled,
}: {
  status: string
  options: readonly string[]
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const { t } = useTranslation("status")
  return (
    // Stops the click from bubbling into the row's own onRowClick (which
    // would otherwise navigate away) before the dropdown even opens —
    // same reasoning as every other in-row action button in this app.
    <div onClick={(e) => e.stopPropagation()} className="inline-block">
      <Select value={status} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className={cn("h-7 w-[118px] text-xs", TONE_CLASS[status.toLowerCase()])}>
          <SelectValue>{planStatusLabel(status, t)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={s}>
              {planStatusLabel(s, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
