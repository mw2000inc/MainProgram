"use client"

import * as React from "react"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { useTranslation } from "@/lib/i18n/i18n-context"

export interface ComboboxOption {
  value: string
  // Groups render as a labeled section, in the order first seen. Omit for a
  // flat, ungrouped list.
  group?: string
}

// A real text input (always typable — a custom value outside `options` is
// never rejected) that also offers a below-anchored list of suggestions,
// unlike a native <input list="..."> datalist, whose popup position and
// styling the browser controls entirely and can't be pinned to open
// directly below the field.
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  showAllOnExactMatch,
  onOptionSelect,
  openOnFocus = true,
  maxResults,
  emptyMessage,
  // Forwarded straight onto the underlying <input> — critically including
  // `id`/`aria-*`, which FormControl (a Radix Slot) clones onto whatever
  // single child it wraps. Without forwarding these through, a FormLabel's
  // htmlFor would point at nothing and the field would be unreachable by
  // label click or screen reader.
  ...inputProps
}: {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  className?: string
  // Opt-in. By default the list filters to whatever is typed, so a field that
  // already holds a complete option (e.g. "Mell") only ever offers that one
  // option back — fine for a long catalog, awkward for a short pick-list
  // someone is trying to change. With this set, a value that exactly matches
  // an option shows the whole list instead.
  showAllOnExactMatch?: boolean
  // Opt-in. Fires only when a suggestion is picked from the list (onChange
  // also fires per keystroke, so it can't tell the two apart) — lets a caller
  // save immediately on a pick while still waiting for blur on typed text.
  onOptionSelect?: (value: string) => void
  // Defaults to true (focusing the field opens the list). Set false where the
  // field is auto-focused on entry — e.g. inside a popover, whose content
  // Radix focuses on open — and an already-open list would cover whatever sits
  // below the field (a Save button). A click or typing still opens it.
  openOnFocus?: boolean
  // Opt-in. Shows at most this many matches (the list scrolls), with a note
  // to keep typing when there are more — for a long catalog like products.
  maxResults?: number
  // Opt-in. Replaces the default "no matches — your typed value will be
  // used" text, for a field where a typed value isn't accepted as-is.
  emptyMessage?: string
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "placeholder" | "className">) {
  const { t } = useTranslation("common")
  const [open, setOpen] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    if (showAllOnExactMatch && options.some((o) => o.value.toLowerCase() === q)) return options
    return options.filter((o) => o.value.toLowerCase().includes(q))
  }, [options, value, showAllOnExactMatch])

  const shown = React.useMemo(() => (maxResults ? filtered.slice(0, maxResults) : filtered), [filtered, maxResults])
  const hiddenCount = filtered.length - shown.length

  // Keyboard: focus stays in the input, so the arrow keys move a highlight
  // through the shown options here (Command's own key handling never sees
  // them), Enter picks the highlighted one, Escape closes the list (the
  // Popover's own dismiss — only the list, never an enclosing Dialog). No
  // option is highlighted until an arrow key is pressed, so Enter on typed
  // text alone behaves as before.
  const [highlighted, setHighlighted] = React.useState("")
  const listRef = React.useRef<HTMLDivElement>(null)
  const pick = (optValue: string) => {
    onChange(optValue)
    onOptionSelect?.(optValue)
    setOpen(false)
    setHighlighted("")
    inputRef.current?.focus()
  }
  const moveHighlight = (step: 1 | -1) => {
    if (shown.length === 0) return
    const index = shown.findIndex((o) => o.value === highlighted)
    const next = shown[index < 0 ? (step === 1 ? 0 : shown.length - 1) : (index + step + shown.length) % shown.length].value
    setHighlighted(next)
    requestAnimationFrame(() => {
      const item = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? []).find((el) => el.dataset.value === next)
      item?.scrollIntoView({ block: "nearest" })
    })
  }

  const groups = React.useMemo(() => {
    const map = new Map<string, ComboboxOption[]>()
    for (const opt of shown) {
      const key = opt.group ?? ""
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(opt)
    }
    return Array.from(map.entries())
  }, [shown])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          {...inputProps}
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setHighlighted("")
            if (!open) setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              if (!open) setOpen(true)
              moveHighlight(e.key === "ArrowDown" ? 1 : -1)
            } else if (e.key === "Enter" && open && highlighted && shown.some((o) => o.value === highlighted)) {
              e.preventDefault()
              pick(highlighted)
            }
            inputProps.onKeyDown?.(e)
          }}
          onFocus={(e) => {
            if (openOnFocus) setOpen(true)
            inputProps.onFocus?.(e)
          }}
          // Also needed alongside onFocus above — a click that both focuses
          // the input AND lands on Radix's own outside-pointerdown listener
          // (added the instant this Popover opens) can otherwise cause it to
          // open and immediately re-close within that same click.
          onClick={() => setOpen(true)}
          placeholder={placeholder}
          className={className}
          autoComplete="off"
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        // Matches the input's own width instead of the fixed w-72 default
        // (Radix exposes the anchor's width as --radix-popover-trigger-width),
        // never wider than the screen allows, so long options wrap.
        className="w-(--radix-popover-trigger-width) max-w-(--radix-popover-content-available-width) p-0"
        // Keeps focus on the input (so typing keeps filtering the list)
        // instead of Radix moving it into the popover on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false} value={highlighted} onValueChange={setHighlighted}>
          {/* This popover is a body-level portal outside the parent Dialog's
              own DOM subtree, so the Dialog's scroll lock (which only
              recognizes scrollable content nested inside it) swallows real
              mouse-wheel scroll events here before the browser's native
              scroll ever runs. Scrolling programmatically instead — via
              scrollTop, not relying on the prevented default — sidesteps
              that entirely, so every option stays reachable. */}
          <CommandList ref={listRef} onWheel={(e) => (e.currentTarget.scrollTop += e.deltaY)}>
            <CommandEmpty>{emptyMessage ?? t("noMatchesTypedValueUsed")}</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group || "_ungrouped"} heading={group || undefined}>
                {items.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => pick(opt.value)}
                    className="whitespace-normal break-words"
                  >
                    {opt.value}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {hiddenCount > 0 && (
              <p className="border-t px-2 py-1.5 text-xs text-muted-foreground" data-testid="combobox-more">
                {t("comboboxMoreMatches", { count: String(hiddenCount) })}
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
