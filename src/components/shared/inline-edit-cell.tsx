"use client"

import * as React from "react"
import { Check, ChevronDown, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CurrencyInput } from "@/components/shared/currency-input"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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
  required,
}: {
  value: string | undefined
  placeholder?: string
  onCommit: (next: string) => void
  className?: string
  // For a field the record's own form doesn't allow blank (e.g. Filter
  // Change's Filter) — an emptied field snaps back to the last saved value
  // on blur instead of committing "".
  required?: boolean
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
        if (required && !draft.trim()) {
          setDraft(value ?? "")
          return
        }
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

// Same draft/blur-commit shape as InlineNumberCell above, but for a
// currency/payment amount specifically (Collections' Amount) — wraps the
// shared CurrencyInput instead of a plain type="number" input, so this
// cell gets the same "₱X,XXX.XX" format-on-blur formatting as the Amount
// field in the Add/Edit form. An invalid or negative entry snaps back to
// the last known value, same as InlineNumberCell.
export function InlineCurrencyCell({
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
    <div onClick={(e) => e.stopPropagation()} className="inline-block">
      <CurrencyInput
        value={draft}
        onChange={setDraft}
        className={cn("h-7 w-24 text-xs", className)}
        onBlur={() => {
          const next = Number(draft)
          if (!Number.isNaN(next) && next >= 0 && next !== value) onCommit(next)
          else setDraft(String(value))
        }}
      />
    </div>
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

// Same draft/blur-commit shape as InlineTextCell above, wrapping the shared
// Combobox instead of a plain Input — for a field that needs "pick from
// suggestions or type your own" (e.g. Collections' Payment Type) rather
// than InlineSelectCell's locked list. Combobox itself commits per
// keystroke via onChange; wrapping it in the same draft state InlineTextCell
// uses means typing doesn't fire a save on every character, only on blur.
//
// Both options below are opt-in and exist for a short pick-list standing in for
// a locked Select (the technician cells): `commitOnSelect` saves the moment a
// suggestion is picked, like the Select did, instead of waiting for a
// click-away (typed text still commits on blur); `showAllOnExactMatch` keeps
// the whole list on offer when the cell already holds one of its options.
export function InlineComboboxCell({
  value,
  options,
  placeholder,
  onCommit,
  className,
  commitOnSelect,
  showAllOnExactMatch,
  autoFocus,
}: {
  value: string | undefined
  options: ComboboxOption[]
  placeholder?: string
  onCommit: (next: string) => void
  className?: string
  commitOnSelect?: boolean
  showAllOnExactMatch?: boolean
  autoFocus?: boolean
}) {
  // Same "adjust state during render, not in an effect" resync pattern as
  // InlineTextCell above — see its comment.
  const [lastSeenValue, setLastSeenValue] = React.useState(value)
  const [draft, setDraft] = React.useState(value ?? "")
  if (value !== lastSeenValue) {
    setLastSeenValue(value)
    setDraft(value ?? "")
  }
  // The value a pick just saved, so the blur that follows a pick (the input
  // is refocused after selecting) doesn't save the same thing a second time
  // while the refetch that updates `value` is still in flight. Cleared by any
  // further typing.
  const pickedRef = React.useRef<string | null>(null)
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      // Pressing a suggestion in the list would otherwise move focus off the
      // input first — firing the blur-commit below with whatever partial text
      // was typed ("Jer") a moment before the pick itself lands ("Jerson
      // Capellon"), i.e. two saves, the first one wrong. The suggestion list is a
      // portal but still a React child of this div, so it sees the press here;
      // only presses that aren't on the input itself are held back from
      // taking focus (a click still selects the item — that's onClick, not focus).
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
      className="inline-block"
    >
      <Combobox
        value={draft}
        onChange={(next) => {
          pickedRef.current = null
          setDraft(next)
        }}
        options={options}
        placeholder={placeholder}
        showAllOnExactMatch={showAllOnExactMatch}
        autoFocus={autoFocus}
        onOptionSelect={
          commitOnSelect
            ? (picked) => {
                pickedRef.current = picked
                if (picked !== (value ?? "")) onCommit(picked)
              }
            : undefined
        }
        className={cn("h-7 w-[150px] text-xs", className)}
        onBlur={() => {
          if (draft !== (value ?? "") && draft !== pickedRef.current) onCommit(draft)
        }}
      />
    </div>
  )
}

export interface GridPickerOption {
  // What gets stored in the field.
  value: string
  // Short name shown under the value on the tile.
  label: string
  // Groups render as a labeled section of tiles, in the order first seen.
  group?: string
}

const GRID_PICKER_SEPARATOR = ", "

function splitPickerTokens(raw: string): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const part of raw.split(/[,;]+/)) {
    const token = part.trim()
    if (token && !seen.has(token)) {
      seen.add(token)
      tokens.push(token)
    }
  }
  return tokens
}

// Catalog options first, in catalog order, then anything that isn't in the
// catalog exactly as it was — so a legacy/hand-typed value is never dropped by
// simply opening and saving the picker.
function composePickerValue(tokens: string[], options: GridPickerOption[]): string {
  const chosen = new Set(tokens)
  const known = options.filter((o) => chosen.has(o.value)).map((o) => o.value)
  const knownSet = new Set(known)
  return [...known, ...tokens.filter((t) => !knownSet.has(t))].join(GRID_PICKER_SEPARATOR)
}

// Multi-select picker for a text field whose value is a comma-separated list
// of catalog codes (Filter Change's Filter: "012, 013"). The cell shows the
// stored text; clicking it opens a popover with a scrollable grid of tiles,
// `columns` per row. Same draft/commit shape as the other Inline*Cells, with
// "commit on blur" becoming "commit on close": nothing is saved per toggle, the
// popover closing (Done, click-away) saves once and Escape discards.
//
// `required` mirrors InlineTextCell's guard — an emptied selection snaps back to
// the last saved value instead of committing "".
//
// Pick-from-the-list-or-type-your-own, like Payment Type's Combobox: give it
// `customPlaceholder`/`addLabel` and the footer gets a text input, so a value
// that isn't in the grid can be added alongside the checked tiles (Enter or Add;
// commas/semicolons separate several). Typed text is never lost — anything still
// in the box when the popover closes (Done, click-away) is added too, and
// Escape discards it along with the rest. A typed value that exactly matches a
// tile just checks that tile.
export function InlineGridPickerCell({
  value,
  options,
  onCommit,
  required,
  placeholder,
  requiredHint,
  otherLabel,
  doneLabel,
  customPlaceholder,
  addLabel,
  columns = 5,
  className,
}: {
  value: string
  options: GridPickerOption[]
  onCommit: (next: string) => void
  required?: boolean
  placeholder: string
  requiredHint: string
  // Heading for entries that aren't in `options` (typed by hand or legacy —
  // kept, and removable).
  otherLabel: string
  doneLabel: string
  // Both provided -> the "type your own" input is shown; omit to keep the
  // picker limited to `options`.
  customPlaceholder?: string
  addLabel?: string
  columns?: number
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  // Text typed into the custom input but not yet added with Enter/Add.
  const [custom, setCustom] = React.useState("")
  // Same "adjust state during render" resync as InlineTextCell, except never
  // mid-selection: a refetch landing while the popover is open must not wipe
  // what's being picked (opening re-seeds the draft from the latest value).
  const [lastSeenValue, setLastSeenValue] = React.useState(value)
  if (value !== lastSeenValue) {
    setLastSeenValue(value)
    if (!open) setDraft(value)
  }
  const escapedRef = React.useRef(false)

  const tokens = splitPickerTokens(draft)
  const selected = new Set(tokens)
  const catalog = React.useMemo(() => new Set(options.map((o) => o.value)), [options])
  const others = tokens.filter((t) => !catalog.has(t))
  const groups = React.useMemo(() => {
    const map = new Map<string, GridPickerOption[]>()
    for (const option of options) {
      const key = option.group ?? ""
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(option)
    }
    return Array.from(map.entries())
  }, [options])

  const allowCustom = !!customPlaceholder && !!addLabel
  const hasPendingCustom = allowCustom && splitPickerTokens(custom).length > 0

  function addCustom() {
    if (!hasPendingCustom) return
    setDraft(composePickerValue(splitPickerTokens(`${draft},${custom}`), options))
    setCustom("")
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    setCustom("")
    if (next) {
      setDraft(value)
      return
    }
    const discard = escapedRef.current
    escapedRef.current = false
    // Whatever is still typed in the custom box counts as added — the same
    // "don't lose what was typed" rule the Combobox follows on blur.
    const composed = composePickerValue(splitPickerTokens(hasPendingCustom ? `${draft},${custom}` : draft), options)
    if (discard || (required && composed === "")) {
      setDraft(value)
      return
    }
    // Compared in normalized form so opening and closing without a change
    // (even on a value with a stray trailing space or different order) never
    // fires a save.
    if (composed !== composePickerValue(splitPickerTokens(value), options)) onCommit(composed)
  }

  function toggle(optionValue: string) {
    const next = selected.has(optionValue) ? tokens.filter((t) => t !== optionValue) : [...tokens, optionValue]
    setDraft(composePickerValue(next, options))
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-block">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            title={value || undefined}
            className={cn("h-7 w-37.5 justify-between gap-1 px-2 text-xs font-normal", className)}
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-xl max-w-[calc(100vw-2rem)]"
          onEscapeKeyDown={() => {
            escapedRef.current = true
          }}
        >
          {others.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{otherLabel}</p>
              <div className="flex flex-wrap gap-1">
                {others.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => setDraft(composePickerValue(tokens.filter((t) => t !== token), options))}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-xs hover:bg-muted/70"
                  >
                    {token}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* A body-level portal outside any parent Dialog's own DOM, so that
              Dialog's scroll lock swallows real mouse-wheel events here — same
              trap Combobox's list documents. Scrolling via scrollTop directly
              sidesteps the prevented default so every tile stays reachable. */}
          <div
            className="max-h-64 space-y-2 overflow-y-auto pr-1"
            onWheel={(e) => (e.currentTarget.scrollTop += e.deltaY)}
          >
            {groups.map(([group, items]) => (
              <div key={group || "_ungrouped"} className="space-y-1">
                {group && <p className="text-xs font-medium text-muted-foreground">{group}</p>}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                  {items.map((option) => {
                    const isSelected = selected.has(option.value)
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="checkbox"
                        aria-checked={isSelected}
                        title={`${option.value} — ${option.label}`}
                        onClick={() => toggle(option.value)}
                        className={cn(
                          "relative flex min-h-12 min-w-0 flex-col items-start justify-center rounded-md border px-2 py-1 text-left transition-colors",
                          isSelected ? "border-primary bg-primary/10" : "border-input hover:bg-muted"
                        )}
                      >
                        <span className="text-xs font-semibold">{option.value}</span>
                        <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{option.label}</span>
                        {isSelected && <Check className="absolute right-1 top-1 h-3 w-3 text-primary" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* In the footer, not above the grid: Radix focuses the first
              focusable thing when the popover opens, and an input there would
              pop the on-screen keyboard on a touch device for what is a
              click-to-pick grid. */}
          {allowCustom && (
            <div className="flex items-center gap-1.5">
              <Input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addCustom()
                  }
                }}
                placeholder={customPlaceholder}
                autoComplete="off"
                className="h-7 flex-1 text-xs"
              />
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={!hasPendingCustom} onClick={addCustom}>
                {addLabel}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {required && tokens.length === 0 && !hasPendingCustom ? requiredHint : ""}
            </span>
            <Button type="button" size="sm" className="h-7" onClick={() => handleOpenChange(false)}>
              {doneLabel}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
