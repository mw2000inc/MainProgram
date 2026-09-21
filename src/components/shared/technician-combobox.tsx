"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { FormControl, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { InlineComboboxCell } from "@/components/shared/inline-edit-cell"
import { TECHNICIANS } from "@/lib/constants"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { isAssignedTechnician, normalizeTechnicianPair } from "@/lib/technicians"

// Every Technician/Serviceman field is pick-from-the-roster-or-type-your-own:
// the TECHNICIANS roster is offered as suggestions, but any name can be typed
// (a contractor, a new hire not on the roster yet, a corrected spelling). Same
// Combobox pattern Payment Type and Product# already use. The stored value is
// still plain text, exactly as it always was — nothing downstream ever
// required it to be a roster name at the column level; the few places that
// only work with roster names (auto-assignment) simply don't pick up a custom
// one.
//
// Up to TWO technicians can be assigned: the components below come in single
// (TechnicianCombobox, InlineTechnicianCell) and pair (TechnicianPairCombobox,
// InlineTechnicianPairCell) forms. The pair rules — no second without a real
// first, no duplicates — live in lib/technicians.ts.
const ALL_OPTIONS: ComboboxOption[] = TECHNICIANS.map((value) => ({ value }))
// Pending Approvals treats blank as "Not assigned", so "N/A" isn't offered there.
const OPTIONS_WITHOUT_NA: ComboboxOption[] = ALL_OPTIONS.filter((o) => o.value !== "N/A")

// The suggestions for a technician box. `exclude` drops one name (the OTHER
// technician on the pair — offering the first technician as the second is
// never useful). "N/A" is only ever offered for a primary.
function technicianOptions(includeNotApplicable: boolean, exclude?: string): ComboboxOption[] {
  const base = includeNotApplicable ? ALL_OPTIONS : OPTIONS_WITHOUT_NA
  const skip = (exclude ?? "").trim().toLowerCase()
  return skip ? base.filter((o) => o.value.toLowerCase() !== skip) : base
}

// The typable technician field for forms and popovers. Whitespace is left alone
// per keystroke (a space between two words has to be typeable) — callers trim
// on save (zod `.trim()` in the form schemas).
export function TechnicianCombobox({
  includeNotApplicable = true,
  exclude,
  placeholder,
  ...props
}: Omit<React.ComponentProps<typeof Combobox>, "options" | "showAllOnExactMatch" | "onOptionSelect"> & {
  // false drops "N/A" from the suggestions (blank already means "not assigned").
  includeNotApplicable?: boolean
  // A name to leave out of the suggestions (the other technician of a pair).
  exclude?: string
}) {
  const { t } = useTranslation("common")
  const options = React.useMemo(() => technicianOptions(includeNotApplicable, exclude), [includeNotApplicable, exclude])
  return (
    <Combobox
      {...props}
      options={options}
      // A short list someone is trying to change: keep it all on offer even
      // when the field already holds one of the names.
      showAllOnExactMatch
      placeholder={placeholder ?? t("selectOrTypeTechnician")}
    />
  )
}

// The primary + optional second technician for places that aren't a react-hook-
// form (the Pending Approvals dialog, the Customer page popover): two
// TechnicianComboboxes stacked, the second disabled until the first is a real
// assignment. Controlled and per-keystroke like TechnicianCombobox itself —
// callers run the pair through normalizeTechnicianPair when they save, which is
// what actually drops a duplicate or an orphaned second.
export function TechnicianPairCombobox({
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
  includeNotApplicable = true,
  primaryLabel,
  primaryId,
  secondaryId,
  primaryPlaceholder,
  openOnFocus,
  className,
  inputClassName,
}: {
  primary: string
  secondary: string
  onPrimaryChange: (next: string) => void
  onSecondaryChange: (next: string) => void
  // Forwarded to the PRIMARY box only — the second never offers "N/A".
  includeNotApplicable?: boolean
  primaryLabel?: string
  primaryId?: string
  secondaryId?: string
  primaryPlaceholder?: string
  // See Combobox's own openOnFocus (false inside a popover, so the auto-focus
  // on entry doesn't open a list over whatever sits below).
  openOnFocus?: boolean
  className?: string
  // Applied to both boxes (e.g. a compact height to match neighbouring fields).
  inputClassName?: string
}) {
  const { t } = useTranslation("common")
  const canHaveSecond = isAssignedTechnician(primary)
  const labelClass = "text-xs font-medium text-muted-foreground"
  return (
    <div className={className ?? "space-y-2"}>
      <div className="space-y-1">
        {primaryLabel && (
          <Label htmlFor={primaryId} className={labelClass}>
            {primaryLabel}
          </Label>
        )}
        <TechnicianCombobox
          id={primaryId}
          value={primary}
          onChange={onPrimaryChange}
          includeNotApplicable={includeNotApplicable}
          placeholder={primaryPlaceholder}
          openOnFocus={openOnFocus}
          className={inputClassName}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={secondaryId} className={labelClass}>
          {t("secondTechnicianOptional")}
        </Label>
        <TechnicianCombobox
          id={secondaryId}
          value={secondary}
          onChange={onSecondaryChange}
          includeNotApplicable={false}
          exclude={primary}
          placeholder={t("secondTechnician")}
          disabled={!canHaveSecond}
          title={canHaveSecond ? undefined : t("secondTechnicianNeedsFirst")}
          openOnFocus={openOnFocus}
          className={inputClassName}
        />
      </div>
    </div>
  )
}

// The "second technician (optional)" item for a react-hook-form form, to drop
// inside a <FormField name="...2" render={({ field }) => ...}> next to the
// form's primary technician field (which is a plain TechnicianCombobox). Disabled
// until `primary` is a real assignment; never offers "N/A" or the primary's own
// name. Callers run the pair through normalizeTechnicianPair on submit, which is
// what actually drops a duplicate.
export function SecondTechnicianFormItem({
  value,
  onChange,
  primary,
  className,
}: {
  value: string | undefined
  onChange: (next: string) => void
  primary: string | undefined
  className?: string
}) {
  const { t } = useTranslation("common")
  const canHaveSecond = isAssignedTechnician(primary)
  return (
    <FormItem className={className}>
      <FormLabel>{t("secondTechnicianOptional")}</FormLabel>
      <FormControl>
        <TechnicianCombobox
          value={value ?? ""}
          onChange={onChange}
          includeNotApplicable={false}
          exclude={primary}
          placeholder={t("secondTechnician")}
          disabled={!canHaveSecond}
          title={canHaveSecond ? undefined : t("secondTechnicianNeedsFirst")}
        />
      </FormControl>
      <FormMessage />
    </FormItem>
  )
}

// One inline technician box (a single value) — the building block of the pair
// cell below. Picking a suggestion saves immediately, like the locked Select it
// replaced; typed text saves on blur. Trimmed, and a change that's only
// whitespace never saves.
export function InlineTechnicianCell({
  value,
  onCommit,
  includeNotApplicable = true,
  exclude,
  placeholder,
  autoFocus,
}: {
  value: string | undefined
  onCommit: (next: string) => void
  includeNotApplicable?: boolean
  exclude?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const { t } = useTranslation("common")
  const options = React.useMemo(() => technicianOptions(includeNotApplicable, exclude), [includeNotApplicable, exclude])
  return (
    <InlineComboboxCell
      value={value}
      options={options}
      // The short form: a blank cell is the common case and the full "Select or
      // type a technician" gets cut off mid-word at the cell's 150px width.
      placeholder={placeholder ?? t("selectOrType")}
      autoFocus={autoFocus}
      commitOnSelect
      showAllOnExactMatch
      onCommit={(next) => {
        const trimmed = next.trim()
        if (trimmed !== (value ?? "")) onCommit(trimmed)
      }}
    />
  )
}

// The inline table-cell version for a technician PAIR (Filter Change,
// Collections and Install serviceman columns). Shows the primary box; the
// second stays out of sight behind a small "+" until it's wanted (or already
// set), so the many rows with one technician don't all grow taller. The "+" is
// disabled until the primary is a real assignment.
//
// `onCommit` gets only what changed, always already normalized: blanking the
// primary (or making it "N/A") clears the second in the same patch, and a second
// that duplicates the first is refused — with a toast, and the box snapped
// back — rather than silently kept or silently dropped.
export function InlineTechnicianPairCell({
  primary,
  secondary,
  onCommit,
}: {
  primary: string | undefined
  secondary: string | undefined
  onCommit: (patch: { primary?: string; secondary?: string }) => void
}) {
  const { t } = useTranslation("common")
  const first = (primary ?? "").trim()
  const second = (secondary ?? "").trim()
  const [revealed, setRevealed] = React.useState(false)
  // Bumped to remount the second box after a refused duplicate, so it shows the
  // saved value again instead of the rejected text.
  const [secondResetKey, setSecondResetKey] = React.useState(0)
  const canAddSecond = isAssignedTechnician(first)
  const showSecond = !!second || revealed

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <InlineTechnicianCell
          value={primary}
          onCommit={(next) => {
            const normalized = normalizeTechnicianPair(next, second)
            onCommit({
              primary: normalized.primary,
              // Only touch the second when normalizing actually changed it.
              ...(normalized.secondary !== second ? { secondary: normalized.secondary } : {}),
            })
          }}
        />
        {!showSecond && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={!canAddSecond}
            title={canAddSecond ? t("addSecondTechnician") : t("secondTechnicianNeedsFirst")}
            aria-label={t("addSecondTechnician")}
            onClick={() => setRevealed(true)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {showSecond && (
        <InlineTechnicianCell
          key={secondResetKey}
          value={secondary}
          includeNotApplicable={false}
          exclude={first}
          placeholder={t("secondTechnician")}
          autoFocus={revealed && !second}
          onCommit={(next) => {
            const normalized = normalizeTechnicianPair(first, next)
            if (next.trim() && !normalized.secondary && isAssignedTechnician(next) && isAssignedTechnician(first)) {
              // The only way a real, assigned name normalizes away here is that
              // it's the first technician typed again.
              toast.error(t("technicianAlreadyAssigned"))
              setSecondResetKey((k) => k + 1)
              return
            }
            if (normalized.secondary !== second) onCommit({ secondary: normalized.secondary })
          }}
        />
      )}
    </div>
  )
}
