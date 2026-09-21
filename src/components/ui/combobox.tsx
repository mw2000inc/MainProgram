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

  const groups = React.useMemo(() => {
    const map = new Map<string, ComboboxOption[]>()
    for (const opt of filtered) {
      const key = opt.group ?? ""
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(opt)
    }
    return Array.from(map.entries())
  }, [filtered])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          {...inputProps}
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (!open) setOpen(true)
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
        // Matches the input's own width instead of the fixed w-72 default.
        className="w-(--radix-popover-anchor-width) p-0"
        // Keeps focus on the input (so typing keeps filtering the list)
        // instead of Radix moving it into the popover on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          {/* This popover is a body-level portal outside the parent Dialog's
              own DOM subtree, so the Dialog's scroll lock (which only
              recognizes scrollable content nested inside it) swallows real
              mouse-wheel scroll events here before the browser's native
              scroll ever runs. Scrolling programmatically instead — via
              scrollTop, not relying on the prevented default — sidesteps
              that entirely, so every option stays reachable. */}
          <CommandList onWheel={(e) => (e.currentTarget.scrollTop += e.deltaY)}>
            <CommandEmpty>{t("noMatchesTypedValueUsed")}</CommandEmpty>
            {groups.map(([group, items]) => (
              <CommandGroup key={group || "_ungrouped"} heading={group || undefined}>
                {items.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => {
                      onChange(opt.value)
                      onOptionSelect?.(opt.value)
                      setOpen(false)
                      inputRef.current?.focus()
                    }}
                  >
                    {opt.value}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
