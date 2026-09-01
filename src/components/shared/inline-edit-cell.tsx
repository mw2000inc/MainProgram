"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// Inline, admin-only edit controls for a Daily Report table cell — every
// one of these lives inside a row that's also clickable (onRowClick), so
// each wraps itself in a stopPropagation guard before the click can bubble
// up and navigate away. Same convention as PlanStatusSelect (see its own
// comment for the same reasoning), just generalized past "status" to any
// date/text/number/select field a column wants to make editable in place.

// A native date input's onChange only ever fires once a complete, valid
// date has actually been picked (never per-keystroke), so there's no
// separate blur step needed here the way there is for free text — this
// commits straight on change.
export function InlineDateCell({
  value,
  onCommit,
  className,
}: {
  value: string | undefined
  onCommit: (next: string) => void
  className?: string
}) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-block">
      <Input
        type="date"
        className={cn("h-7 w-[136px] text-xs", className)}
        value={value ?? ""}
        onChange={(e) => e.target.value && onCommit(e.target.value)}
      />
    </div>
  )
}

// Free-text field (Notes, etc.) — committed on blur rather than per
// keystroke, so typing a sentence doesn't fire a save (and a toast) on
// every character. Keeps its own draft state so the field stays
// responsive while typing, resyncing whenever the underlying value changes
// from elsewhere (another admin's edit landing via the query cache).
export function InlineTextCell({
  value,
  placeholder,
  onCommit,
  className,
}: {
  value: string | undefined
  placeholder?: string
  onCommit: (next: string) => void
  className?: string
}) {
  // Resyncing draft to an incoming value change (another admin's edit
  // landing via the query cache) belongs during render, not in an effect —
  // an effect would fire one render late and risk clobbering a keystroke
  // the user just made. This is React's own documented "adjust state when
  // a prop changes" pattern: track the last value we've seen, and if it
  // moved, snap draft to it in the same render rather than after.
  const [lastSeenValue, setLastSeenValue] = React.useState(value)
  const [draft, setDraft] = React.useState(value ?? "")
  if (value !== lastSeenValue) {
    setLastSeenValue(value)
    setDraft(value ?? "")
  }
  return (
    <Input
      className={cn("h-7 text-xs", className)}
      value={draft}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== (value ?? "")) onCommit(draft)
      }}
    />
  )
}

// Same draft/blur-commit shape as InlineTextCell, for numeric fields (e.g.
// Amount). An invalid or negative entry just snaps back to the last known
// value on blur instead of committing garbage.
export function InlineNumberCell({
  value,
  onCommit,
  className,
}: {
  value: number
  onCommit: (next: number) => void
  className?: string
}) {
  // Same "adjust state during render, not in an effect" resync pattern as
  // InlineTextCell above — see its comment.
  const [lastSeenValue, setLastSeenValue] = React.useState(value)
  const [draft, setDraft] = React.useState(String(value))
  if (value !== lastSeenValue) {
    setLastSeenValue(value)
    setDraft(String(value))
  }
  return (
    <Input
      type="number"
      step="0.01"
      min="0"
      className={cn("h-7 w-24 text-xs", className)}
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = Number(draft)
        if (!Number.isNaN(next) && next >= 0 && next !== value) onCommit(next)
        else setDraft(String(value))
      }}
    />
  )
}

// Generic single-select field committed immediately on change (e.g.
// Serviceman, from the same fixed TECHNICIANS list used elsewhere) —
// unlike PlanStatusSelect this has no per-value tone coloring, since it's
// not a status.
export function InlineSelectCell({
  value,
  options,
  placeholder = "Select",
  onCommit,
  className,
}: {
  value: string | undefined
  options: readonly string[]
  placeholder?: string
  onCommit: (next: string) => void
  className?: string
}) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-block">
      <Select value={value || undefined} onValueChange={onCommit}>
        <SelectTrigger className={cn("h-7 w-[150px] text-xs", className)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
