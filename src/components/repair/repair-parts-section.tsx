"use client"

import * as React from "react"
import { format, parseISO } from "date-fns"
import { CalendarDays, ChevronDown, Maximize2, Pencil, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useProducts } from "@/lib/hooks/use-inventory"
import {
  useCreateRepairPlanPart,
  useDeleteRepairPlanPart,
  useRepairPlanParts,
  useUpdateRepairPlanPart,
} from "@/lib/hooks/use-repair-plan-parts"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate, parseItemString } from "@/lib/utils"
import type { RepairPlanPart } from "@/lib/types"

// Full month names for RepairDateSwitcher's own Month <Select> — year 2000
// is an arbitrary leap year, only ever used to get date-fns to format each
// index (0-11) as a name, never displayed itself.
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMMM"))

function PartsTable({
  parts,
  canEdit,
  onEdit,
  onDelete,
}: {
  parts: RepairPlanPart[]
  canEdit: boolean
  onEdit: (part: RepairPlanPart) => void
  onDelete: (part: RepairPlanPart) => void
}) {
  const { t } = useTranslation("repair")
  const { t: tFields } = useTranslation("fields")

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tFields("partNo")}</TableHead>
          <TableHead>{t("part")}</TableHead>
          <TableHead>{t("inOut")}</TableHead>
          <TableHead>{tFields("quantity")}</TableHead>
          {canEdit && <TableHead className="w-16" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {parts.map((part) => (
          <TableRow
            key={part.id}
            className={canEdit ? "cursor-pointer" : undefined}
            onClick={canEdit ? () => onEdit(part) : undefined}
          >
            <TableCell className="font-medium">{part.productSku || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{part.productName || "—"}</TableCell>
            <TableCell>{part.inOut}</TableCell>
            <TableCell>{part.quantity}</TableCell>
            {canEdit && (
              <TableCell>
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(part)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-danger hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(part)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// Groups by each row's own partDate (most recent first) so a repair with
// parts logged across more than one visit/date reads as separate dated
// sub-tables instead of one flat, undated list — see partDate's own comment
// on RepairPlanPart for how it differs from createdAt.
function groupPartsByDate(parts: RepairPlanPart[]): { date: string; parts: RepairPlanPart[] }[] {
  const map = new Map<string, RepairPlanPart[]>()
  for (const part of parts) {
    const list = map.get(part.partDate)
    if (list) list.push(part)
    else map.set(part.partDate, [part])
  }
  return Array.from(map, ([date, dateParts]) => ({ date, parts: dateParts })).sort((a, b) =>
    b.date.localeCompare(a.date)
  )
}

function GroupedPartsTables({
  parts,
  canEdit,
  onEdit,
  onDelete,
}: {
  parts: RepairPlanPart[]
  canEdit: boolean
  onEdit: (part: RepairPlanPart) => void
  onDelete: (part: RepairPlanPart) => void
}) {
  const { t } = useTranslation("repair")

  if (parts.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("noPartsFound")}</p>
  }

  const groups = groupPartsByDate(parts)
  // A single date (the common case — one visit) skips the date sub-heading
  // entirely, since it would just repeat the repair record's own Issued
  // Date field above for no benefit.
  if (groups.length === 1) {
    return <PartsTable parts={groups[0].parts} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
  }

  return (
    <div className="divide-y">
      {groups.map((group) => (
        <div key={group.date} className="py-2 first:pt-0">
          <p className="px-2 pb-1 text-xs font-semibold text-muted-foreground">{formatDate(group.date)}</p>
          <PartsTable parts={group.parts} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ))}
    </div>
  )
}

// Exported alongside PartFormDialog so repair-form-dialog.tsx's own onStage
// handler can be typed against exactly what that dialog submits.
export type PartFormInput = {
  productId?: string
  customPartNo?: string
  customPartName?: string
  inOut: "IN" | "OUT"
  quantity: number
  partDate: string
}

// A part added while creating a brand-new repair — before that repair has a
// real id for repair_plan_parts.repair_plan_id to reference, so it can't be
// persisted yet (see repair-form-dialog.tsx's own comment on the two-step
// create-repair-then-create-its-parts submit). tempId is purely a client-
// side React key/identity, replaced by a real id once the repair itself
// saves and this gets submitted for real. productSku/productName are
// captured at stage time (from the selected catalog product, or the
// free-typed custom name) rather than re-derived later, mirroring how a
// real RepairPlanPart's own denormalized fields work.
export interface StagedRepairPlanPart {
  tempId: string
  productId?: string
  customPartNo?: string
  customPartName?: string
  productSku: string
  productName: string
  inOut: "IN" | "OUT"
  quantity: number
  partDate: string
}

// Exported so repair-form-dialog.tsx can reuse this exact same form (same
// fields, same catalog-or-custom validation) for staging a new repair's
// parts before it exists, rather than a second, duplicated part-entry form.
// repairPlanId/part are the "real" (network-backed) mode this component has
// always had; stagedPart/onStage are the new staging mode — exactly one of
// (repairPlanId) or (onStage) is ever provided by a caller, never both.
export function PartFormDialog({
  open,
  onOpenChange,
  repairPlanId,
  part,
  stagedPart,
  onStage,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Required in the real (network-backed) mode; unused in staging mode.
  repairPlanId?: string
  // Undefined = adding a new row; set = editing that existing row, form
  // pre-populated from it. Real mode only.
  part?: RepairPlanPart
  // Staging mode's own equivalent of `part` above — editing an
  // already-staged (not yet saved) entry.
  stagedPart?: StagedRepairPlanPart
  // Provided instead of repairPlanId to put this dialog in staging mode:
  // submitting calls this instead of the create/update mutations, and
  // never touches the network. tempId is passed through when editing an
  // existing staged entry (so the caller replaces it in place instead of
  // appending a duplicate), omitted when adding a new one.
  onStage?: (input: PartFormInput & { productSku: string; productName: string }, tempId?: string) => void
  defaultDate: string
}) {
  const { t } = useTranslation("repair")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: products = [] } = useProducts()
  const createPart = useCreateRepairPlanPart()
  const updatePart = useUpdateRepairPlanPart()
  const prefill = part ?? stagedPart
  const isEditing = !!prefill

  const formatPart = React.useCallback((p: (typeof products)[number]) => `${p.sku} — ${p.name}`, [])

  // Reconstructed straight from the row's own already-denormalized
  // productSku/productName (see repair-plan-parts.ts's fromRow, or
  // StagedRepairPlanPart's own comment for the staging-mode equivalent)
  // rather than looked up in `products` — that list may not have loaded yet
  // on first render, but the row already carries the exact display values
  // either way, catalog-linked or custom.
  const [partText, setPartText] = React.useState(() =>
    prefill ? (prefill.productId ? `${prefill.productSku} — ${prefill.productName}` : prefill.productName) : ""
  )
  const [partNoText, setPartNoText] = React.useState(() => prefill?.productSku ?? "")
  const [inOutText, setInOutText] = React.useState<string>(prefill?.inOut ?? "IN")
  const [quantity, setQuantity] = React.useState(prefill ? String(prefill.quantity) : "1")
  const [date, setDate] = React.useState(prefill?.partDate ?? defaultDate)

  // Every field below is a typable Combobox (free text + filtered
  // suggestions), not a click-only native Select. in_out is still a real,
  // constrained value underneath (a DB check(in_out in ('IN','OUT'))), so
  // canSubmit only allows an exact "IN"/"OUT" match there — but Part/Part No
  // are deliberately NOT required to resolve to a real catalog product: a
  // part that isn't in the catalog yet can still be logged as a one-off
  // custom entry (see the repair_plan_parts_custom_entries migration).
  const partOptions: ComboboxOption[] = React.useMemo(() => products.map((p) => ({ value: formatPart(p) })), [
    products,
    formatPart,
  ])
  const partNoOptions: ComboboxOption[] = React.useMemo(() => products.map((p) => ({ value: p.sku })), [products])
  const inOutOptions: ComboboxOption[] = React.useMemo(() => [{ value: "IN" }, { value: "OUT" }], [])

  // Part and Part No are two independent, clickable entry points into the
  // SAME product catalog — picking a real catalog suggestion in either one
  // auto-fills the other so they can never drift out of sync while they
  // describe an actual product. Typing something that doesn't match any
  // catalog entry just leaves them as independent free text instead (a
  // custom, not-yet-cataloged part) — see canSubmit/the submit handler
  // below for how that's still addable.
  //
  // A custom Part is usually AppSheet's combined "[code] / [description]"
  // string (e.g. "1080 / T1 Old) Tank Cover Assy"), so Part No is derived
  // from that leading numeric code via the same parseItemString the Product
  // form uses for Item -> SKU. Only numeric codes are taken: a free-typed
  // name like "Hot / Cold Tap" shouldn't yield a Part No of "Hot".
  function derivedPartNo(text: string): string | null {
    const catalogMatch = products.find((p) => formatPart(p) === text)
    if (catalogMatch) return catalogMatch.sku
    const parsed = parseItemString(text)
    return parsed && /^\d+$/.test(parsed.sku) ? parsed.sku : null
  }

  function handlePartChange(value: string) {
    const previous = derivedPartNo(partText)
    const next = derivedPartNo(value)
    setPartText(value)
    if (products.some((p) => formatPart(p) === value)) {
      setPartNoText(next ?? "")
      return
    }
    // Part No follows Part only while it's blank or still holds what Part
    // last derived, so a Part No the admin typed themselves is never
    // overwritten (same "never clobbers" rule as the Product form's SKU).
    const current = partNoText.trim()
    if ((next !== null || previous !== null) && (current === "" || current === previous)) {
      setPartNoText(next ?? "")
    }
  }

  function handlePartNoChange(value: string) {
    setPartNoText(value)
    const match = products.find((p) => p.sku === value)
    if (match) setPartText(formatPart(match))
  }

  const selectedProduct = products.find((p) => formatPart(p) === partText && p.sku === partNoText)
  const trimmedPart = partText.trim()
  const trimmedPartNo = partNoText.trim()
  const resolvedInOut = inOutText.trim().toUpperCase()
  // Not gated on selectedProduct — a part that isn't in the catalog yet is
  // still addable, as a one-off custom entry, as long as it's actually
  // named by something (Part or Part No, not necessarily both).
  const canSubmit =
    (!!selectedProduct || !!trimmedPart || !!trimmedPartNo) &&
    (resolvedInOut === "IN" || resolvedInOut === "OUT") &&
    Number(quantity) > 0 &&
    !!date

  const saving = createPart.isPending || updatePart.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEditing ? t("editPart") : t("addPart")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("part")}</label>
            {/* Part No shown alongside the name in every suggestion so a
                part can be found by typing its code, not just its (often
                long) description — matches the table's own Part No/Part
                split below. */}
            <Combobox value={partText} onChange={handlePartChange} options={partOptions} placeholder={t("selectProduct")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{tFields("partNo")}</label>
            {/* Independently typable/clickable, same as Part above — picking
                a suggestion here (or in Part) auto-fills the other field via
                handlePartNoChange/handlePartChange, so they always describe
                the same product. */}
            <Combobox
              value={partNoText}
              onChange={handlePartNoChange}
              options={partNoOptions}
              placeholder={t("selectProduct")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("inOut")}</label>
              <Combobox value={inOutText} onChange={setInOutText} options={inOutOptions} placeholder="IN / OUT" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{tFields("quantity")}</label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("partDate")}</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={!canSubmit || saving}
            onClick={async () => {
              if (resolvedInOut !== "IN" && resolvedInOut !== "OUT") return
              const input: PartFormInput = selectedProduct
                ? { productId: selectedProduct.id, inOut: resolvedInOut, quantity: Number(quantity), partDate: date }
                : {
                    customPartNo: trimmedPartNo || undefined,
                    customPartName: trimmedPart || undefined,
                    inOut: resolvedInOut,
                    quantity: Number(quantity),
                    partDate: date,
                  }
              if (onStage) {
                onStage(
                  { ...input, productSku: selectedProduct?.sku ?? trimmedPartNo, productName: selectedProduct?.name ?? trimmedPart },
                  stagedPart?.tempId
                )
                onOpenChange(false)
                return
              }
              if (part) {
                await updatePart.mutateAsync({ id: part.id, repairPlanId: repairPlanId!, input })
              } else {
                await createPart.mutateAsync({ repairPlanId: repairPlanId!, input })
              }
              onOpenChange(false)
            }}
          >
            {saving ? tCommon("saving") : isEditing ? tCommon("save") : tCommon("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Shown right after the "Part No (n)" badge (both the compact panel and the
// Expand modal render the exact same instance/props, so there's only ever
// one date-picker implementation to keep in sync) — the active repair
// record's own date (issuedDate), formatted MM/DD/YYYY. One Popover+Calendar
// does double duty:
//   - Picking a day that matches another repair_plans record sharing this
//     order_no (a repeat visit, listed in historyDates) navigates the whole
//     panel to that record instead of editing anything — those days are
//     underlined on the calendar so they're visible before clicking.
//   - Picking any other day edits THIS record's own issued_date (via
//     onEditDate — repair-plan/page.tsx wires that to the same
//     useUpdateRepairPlan mutation the Status column already uses), and
//     invalidates the repairPlans query the same way any other edit does.
// Read-only (a plain badge, nothing clickable) only when there's truly
// nothing to do with it: a single-visit order viewed by a non-admin.
function RepairDateSwitcher({
  activeId,
  currentDate,
  historyDates,
  canEdit,
  onSelectDate,
  onEditDate,
}: {
  activeId: string
  currentDate: string
  historyDates: { id: string; date: string }[]
  canEdit: boolean
  onSelectDate: (id: string) => void
  onEditDate: (newDate: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  // The month/year the calendar GRID is currently showing — separate from
  // currentDate (the actually-selected day), since browsing to a different
  // month via the Selects below shouldn't itself change what's selected.
  // Resets to currentDate's own month every time the popover opens (see
  // handleOpenChange) rather than remembering wherever it was last left.
  const [viewMonth, setViewMonth] = React.useState(() => parseISO(currentDate))

  const otherVisitDates = React.useMemo(
    () => historyDates.filter((h) => h.id !== activeId).map((h) => parseISO(h.date)),
    [historyDates, activeId]
  )

  // Standalone Month/Year <Select> controls driving the Calendar's month/
  // onMonthChange directly, INSTEAD of react-day-picker's own
  // captionLayout="dropdown" — that slot's default implementation renders a
  // real native <select> made invisible (opacity-0) and stacked over a
  // plain label purely so the browser's own option list still receives
  // clicks; overriding just that slot with a Radix Select still leaves it
  // sitting inside react-day-picker's own caption DOM structure, whose
  // pointer-event handling is tuned for that invisible-overlay trick, not
  // an actual visible trigger button — clicks on the trigger itself could
  // still get intercepted before ever reaching it. Building the controls
  // entirely outside react-day-picker's own rendering, wired through the
  // Calendar's own public month/onMonthChange contract, sidesteps that
  // internal DOM/overlay entirely: there is nothing left for it to
  // intercept, and this Select behaves exactly like every other Select in
  // the app because it's not living inside a foreign component's slot.
  //
  // ± 10 years from THIS render's current year, not a hardcoded 2018-2030 —
  // stays correct without ever needing another edit here.
  const yearOptions = React.useMemo(() => {
    const year = new Date().getFullYear()
    return Array.from({ length: 21 }, (_, i) => year - 10 + i)
  }, [])
  const calendarBounds = React.useMemo(
    () => ({
      startMonth: new Date(yearOptions[0], 0),
      endMonth: new Date(yearOptions[yearOptions.length - 1], 11),
    }),
    [yearOptions]
  )

  function handleOpenChange(next: boolean) {
    if (next) setViewMonth(parseISO(currentDate))
    setOpen(next)
  }

  function handleSelect(date: Date | undefined) {
    if (!date) return
    setOpen(false)
    const iso = format(date, "yyyy-MM-dd")
    if (iso === currentDate) return
    const otherVisit = historyDates.find((h) => h.id !== activeId && h.date === iso)
    if (otherVisit) {
      onSelectDate(otherVisit.id)
    } else if (canEdit) {
      onEditDate(iso)
    }
  }

  const label = (
    <>
      <CalendarDays className="h-3 w-3" />
      {formatDate(currentDate, "MM/dd/yyyy")}
    </>
  )

  if (!canEdit && historyDates.length <= 1) {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        {label}
      </Badge>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="start"
        // The Month/Year Selects below still render their own open listbox
        // in a SEPARATE Radix portal, appended to document.body just like
        // this Popover's own content — so, DOM-wise, that listbox isn't a
        // descendant of this PopoverContent at all. Without this guard,
        // clicking a month/year option registers as a pointer-down
        // "outside" this popover and closes the whole calendar before the
        // selection is even applied. Checks both the app's own
        // data-slot="select-content" marker (ui/select.tsx) and the
        // standard role="listbox" Radix already puts on it, so this still
        // holds even if that data-slot ever changes.
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-slot="select-content"]') || target?.closest('[role="listbox"]')) {
            event.preventDefault()
          }
        }}
      >
        <div className="flex items-center gap-1.5 border-b p-2">
          <Select
            value={String(viewMonth.getMonth())}
            onValueChange={(v) => setViewMonth((d) => new Date(d.getFullYear(), Number(v), 1))}
          >
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue>{MONTH_NAMES[viewMonth.getMonth()]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(viewMonth.getFullYear())}
            onValueChange={(v) => setViewMonth((d) => new Date(Number(v), d.getMonth(), 1))}
          >
            <SelectTrigger size="sm" className="h-7 w-21.25 text-xs">
              <SelectValue>{viewMonth.getFullYear()}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {yearOptions.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          selected={parseISO(currentDate)}
          onSelect={handleSelect}
          month={viewMonth}
          onMonthChange={setViewMonth}
          startMonth={calendarBounds.startMonth}
          endMonth={calendarBounds.endMonth}
          // The default caption row (react-day-picker's own month/year
          // label + prev/next arrows) would otherwise duplicate the Selects
          // above — hidden here rather than in ui/calendar.tsx since that's
          // a shared component and this is the only caller that replaces
          // its caption with a custom one. The prev/next arrows still work
          // (they call onMonthChange internally, same as ever); only the
          // redundant text label is gone.
          classNames={{ month_caption: "hidden" }}
          modifiers={{ otherVisit: otherVisitDates }}
          modifiersClassNames={{ otherVisit: "underline underline-offset-2 font-semibold" }}
        />
      </PopoverContent>
    </Popover>
  )
}

// Repair Plan's related "Part No" line-items section (AppSheet parity) —
// rendered inside DetailPanel's `extra` slot, below the core field grid.
// Deliberately a small, purpose-built widget rather than the shared
// DashboardPlanPanel/DataTable combo used for larger related-record lists
// elsewhere (e.g. MemberOrderDetail's OrderRelatedSection): those bring a
// search box, status filter, and multi-select chrome that don't apply to a
// short (typically single-digit) parts list and would just add noise the
// AppSheet source view doesn't have either.
//
// The caller should render this keyed by repairPlanId (see
// repair-plan/page.tsx) — RepairDateSwitcher can swap repairPlanId out from
// under an otherwise-unchanged parent (the DetailPanel stays open, just
// pointed at a different repair record), and a key is what forces this
// component's own open-form/deleting state to reset for the newly-selected
// record instead of an effect-based reset. expandedOpen is the one
// exception — it's owned by the caller (not local state), specifically so
// the repair-plan list table's own Date column can jump straight to this
// modal for a row that isn't even selected yet.
export function RepairPartsSection({
  repairPlanId,
  canEdit,
  // The repair record's own order number, shown as a plain badge next to
  // the date pill so both are visible at a glance without opening Edit.
  orderNo,
  // The repair record's own issued date — the sensible default for a new
  // part's Date field (usually more useful than "today" when logging parts
  // after the fact), see PartFormDialog's own defaultDate. Also the value
  // RepairDateSwitcher displays for this record.
  defaultDate,
  // Every repair_plans record sharing this one's order_no (repeat visits
  // for the same order), each as { id, date } — feeds RepairDateSwitcher.
  // A single-element (or empty) list just renders as a plain, non-clickable
  // date badge there.
  historyDates,
  onSelectDate,
  // Persists a new issued_date for THIS repair record (picking a day on
  // RepairDateSwitcher's calendar that isn't one of historyDates' existing
  // visits) — repair-plan/page.tsx wires this to the same useUpdateRepairPlan
  // mutation its own Status column already uses.
  onEditDate,
  // Controls the "Expand" modal (full itemized parts history) — lifted up
  // to the caller rather than local state, so the repair-plan list table's
  // own Date column can open this same modal directly (jumping straight to
  // it on a click, without first requiring a separate click on this
  // component's own Expand button).
  expandedOpen,
  onExpandedOpenChange,
}: {
  repairPlanId: string
  canEdit: boolean
  orderNo: string
  defaultDate: string
  historyDates: { id: string; date: string }[]
  onSelectDate: (id: string) => void
  onEditDate: (newDate: string) => void
  expandedOpen: boolean
  onExpandedOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("repair")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: parts = [], isPending } = useRepairPlanParts(repairPlanId)
  const deletePart = useDeleteRepairPlanPart()
  // Undefined = closed. "new" = Add. A RepairPlanPart = editing that row.
  const [formTarget, setFormTarget] = React.useState<RepairPlanPart | "new" | undefined>(undefined)
  // Bumped every time the form dialog is opened (Add OR Edit), and passed
  // to it as `key` — forces a remount (fresh draft state) per open instead
  // of an effect-based reset (see schedule-agenda.tsx's own
  // MarkJobDoneDialog for the same pattern), and also correctly resets when
  // switching from editing one row straight to another.
  const [formKey, setFormKey] = React.useState(0)
  const [deleting, setDeleting] = React.useState<RepairPlanPart | undefined>(undefined)
  // The compact table's own show/hide — expanded by default. Independent of
  // expandedOpen above (the separate Maximize2 modal, which always shows the
  // full table regardless of this).
  const [collapsed, setCollapsed] = React.useState(false)

  function openAdd() {
    setFormKey((k) => k + 1)
    setFormTarget("new")
  }

  function openEdit(part: RepairPlanPart) {
    setFormKey((k) => k + 1)
    setFormTarget(part)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        {/* The header row itself is the accordion trigger now — Order # &
            Date (read together as one "#001-0516 • 09/16/2026" pill) are
            the headline, not just "Part No (n)" — representing that day's
            whole repair session, not only its parts. A plain div (not a
            <button>) is what makes this work: RepairDateSwitcher renders
            its own real <button> (a Popover trigger) inside here, and a
            <button> can't legally contain another interactive <button> —
            nesting it inside a div with its own stopPropagation wrapper is
            both valid HTML and keeps clicking the date from also toggling
            collapse, so it stays a fully working date editor/history-
            switcher rather than becoming a dead label. The Order #/count
            badges are plain, non-interactive text, so their own clicks are
            left to bubble up and toggle normally, same as clicking any
            other blank part of this row. */}
        <div className="flex flex-wrap items-center gap-2 cursor-pointer" onClick={() => setCollapsed((v) => !v)}>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", collapsed && "-rotate-90")} />
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="font-mono font-normal">
              #{orderNo}
            </Badge>
            <span className="text-xs text-muted-foreground">•</span>
            <div onClick={(e) => e.stopPropagation()}>
              <RepairDateSwitcher
                activeId={repairPlanId}
                currentDate={defaultDate}
                historyDates={historyDates}
                canEdit={canEdit}
                onSelectDate={onSelectDate}
                onEditDate={onEditDate}
              />
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            {tFields("partNo")}
            <Badge variant="secondary">{parts.length}</Badge>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2"
            onClick={(e) => {
              e.stopPropagation()
              onExpandedOpenChange(true)
            }}
          >
            <Maximize2 className="h-3.5 w-3.5" /> {tCommon("expand")}
          </Button>
          {canEdit && (
            <Button
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={(e) => {
                e.stopPropagation()
                openAdd()
              }}
            >
              <Plus className="h-3.5 w-3.5" /> {tCommon("add")}
            </Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="rounded-md border max-h-64 overflow-y-auto">
          {isPending ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{tCommon("loading")}</p>
          ) : (
            <GroupedPartsTables parts={parts} canEdit={canEdit} onEdit={openEdit} onDelete={setDeleting} />
          )}
        </div>
      )}

      {canEdit && (
        <PartFormDialog
          key={formKey}
          open={!!formTarget}
          onOpenChange={(o) => !o && setFormTarget(undefined)}
          repairPlanId={repairPlanId}
          part={formTarget === "new" ? undefined : formTarget}
          defaultDate={defaultDate}
        />
      )}

      <Dialog open={expandedOpen} onOpenChange={onExpandedOpenChange}>
        <DialogContent
          className="sm:max-w-2xl"
          // A dialog opened from inside this one (the Add/Edit Part dialog
          // above, or the delete-part ConfirmDialog below) is a React-tree
          // sibling, not a child, so a press inside it counts as "outside"
          // here — same fix, same reasoning as dashboard-plan-panel.tsx's
          // own Maximize dialog. A press that started inside another
          // dialog/alertdialog is never a dismissal of this one.
          onPointerDownOutside={(e) => {
            const target = e.detail.originalEvent.target
            if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]')) e.preventDefault()
          }}
        >
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="flex items-center gap-2">
                {tFields("partNo")} <Badge variant="secondary">{parts.length}</Badge>
              </DialogTitle>
              {/* Same component, same props as the compact header above —
                  one date, one picker, kept in sync just by both instances
                  reading the same repairPlanId/historyDates/onEditDate. */}
              <RepairDateSwitcher
                activeId={repairPlanId}
                currentDate={defaultDate}
                historyDates={historyDates}
                canEdit={canEdit}
                onSelectDate={onSelectDate}
                onEditDate={onEditDate}
              />
            </div>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <GroupedPartsTables parts={parts} canEdit={canEdit} onEdit={openEdit} onDelete={setDeleting} />
          </div>
          {canEdit && (
            <DialogFooter>
              <Button size="sm" className="gap-1.5" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" /> {t("addPart")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deletePartTitle")}
        description={t("deletePartDescription")}
        loading={deletePart.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deletePart.mutateAsync({ id: deleting.id, repairPlanId })
          setDeleting(undefined)
        }}
      />
    </div>
  )
}
