"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { ManualSlipCategory, ManualSlipItem } from "@/lib/release-slip-manual"

// Adds one extra part or errand note to the day's Release Slip. The item is
// a free-text field; `productOptions` (SKUs, for admins — technicians can't
// read the product list) are offered as suggestions.
//
// Typing or picking an item pre-fills Account / Location / Notes from
// `noteSuggestions` (the technician's jobs that day using that SKU, else the
// product's name). The note is only replaced while it still holds the last
// pre-filled text, or is empty — once the user types their own, it is theirs.
export function AddSlipItemDialog({
  open,
  onOpenChange,
  productOptions,
  noteSuggestions,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productOptions: ComboboxOption[]
  noteSuggestions: (item: string) => string[]
  onAdd: (item: ManualSlipItem) => void
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const [category, setCategory] = React.useState<ManualSlipCategory>("part")
  const [item, setItem] = React.useState("")
  const [direction, setDirection] = React.useState<"out" | "in">("out")
  const [qty, setQty] = React.useState("1")
  const [note, setNote] = React.useState("")
  const [autoNote, setAutoNote] = React.useState("")
  const [suggestions, setSuggestions] = React.useState<string[]>([])

  const changeItem = (value: string) => {
    setItem(value)
    const next = noteSuggestions(value)
    setSuggestions(next)
    // Still the pre-filled text, or emptied by the user: fill it (again).
    if (note === autoNote || note.trim() === "") {
      setNote(next[0] ?? "")
      setAutoNote(next[0] ?? "")
    }
  }
  const applySuggestion = (value: string) => {
    setNote(value)
    setAutoNote(value)
  }

  const reset = () => {
    setCategory("part")
    setItem("")
    setDirection("out")
    setQty("1")
    setNote("")
    setAutoNote("")
    setSuggestions([])
  }
  const qtyNumber = Number(qty)
  const qtyValid = Number.isFinite(qtyNumber) && qtyNumber > 0
  // A part needs an item and a quantity; an errand needs its note (its item is optional).
  const valid = category === "part" ? item.trim() !== "" && qtyValid : note.trim() !== "" && (item.trim() === "" || qtyValid)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    onAdd({ id: crypto.randomUUID(), category, item: item.trim(), direction, qty: qtyValid ? qtyNumber : 1, note: note.trim() })
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent data-testid="slip-add-dialog">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("releaseSlipAddTitle")}</DialogTitle>
            <DialogDescription>{t("releaseSlipAddDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("releaseSlipAddCategory")}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as ManualSlipCategory)}>
                <SelectTrigger className="w-full" data-testid="slip-add-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="part">{t("releaseSlipAddCategoryPart")}</SelectItem>
                  <SelectItem value="errand">{t("releaseSlipAddCategoryErrand")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="slip-add-item">{t("releaseSlipAddItem")}</Label>
              <Combobox
                id="slip-add-item"
                value={item}
                onChange={changeItem}
                options={productOptions}
                placeholder={category === "part" ? t("releaseSlipAddItemPlaceholder") : t("releaseSlipAddItemOptional")}
                openOnFocus={false}
                data-testid="slip-add-item"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("releaseSlipAddDirection")}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "out" | "in")}>
                <SelectTrigger className="w-full" data-testid="slip-add-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="out">{t("releaseSlipAddOut")}</SelectItem>
                  <SelectItem value="in">{t("releaseSlipAddIn")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slip-add-qty">{t("releaseSlipAddQty")}</Label>
              <Input id="slip-add-qty" type="number" min="0" step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="slip-add-qty" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="slip-add-note">{t("releaseSlipAddNote")}</Label>
              <Input
                id="slip-add-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={category === "part" ? t("releaseSlipAddNotePart") : t("releaseSlipAddNoteErrand")}
                data-testid="slip-add-note"
              />
              {suggestions.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1" data-testid="slip-add-suggestions">
                  <span className="text-xs text-muted-foreground">{t("releaseSlipAddSuggestions")}</span>
                  {suggestions.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={value === note ? "secondary" : "outline"}
                      className="h-6 px-2 text-xs"
                      onClick={() => applySuggestion(value)}
                      data-testid="slip-add-suggestion"
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!valid} data-testid="slip-add-submit">
              {tCommon("add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
