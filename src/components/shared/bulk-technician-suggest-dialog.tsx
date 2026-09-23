"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TechnicianCombobox } from "@/components/shared/technician-combobox"

export interface BulkSuggestItem {
  id: string
  label: string
}

export interface TechnicianSuggestion {
  technician: string
  distanceKm: number | null
  nearbyCount: number
  explanation: string
  outsideCoverage: boolean
}

export interface BulkSuggestionEntry {
  id: string
  result: TechnicianSuggestion | { error: string }
}

// Shared by Filter Change and Schedule's own "Auto-suggest technicians" —
// same preview-then-apply shape both pages' scheduling modules already
// use server-side (previewSuggestionsForPlans/previewSuggestionsForJobs,
// applyTechnicianAssignments/applyTechnicianAssignmentsToJobs): opening
// this dialog fetches a suggestion for every item up front (onPreview,
// read-only — nothing is saved yet), the admin can review and override any
// individual pick via the same TechnicianCombobox used everywhere else in
// this app, and only onConfirm (onApply) actually writes anything. A
// deliberately STATIC preview — editing one row's technician never
// recomputes or changes any other row's shown suggestion, so the batch
// stays predictable while it's being reviewed.
//
// Kept entity-agnostic (id/label only, no "plan" or "job" concept) so both
// callers can reuse the exact same component rather than each building
// their own copy — every domain-specific string (title, labels, i18n) is a
// prop, not baked in here.
export function BulkTechnicianSuggestDialog({
  open,
  onOpenChange,
  items,
  onPreview,
  onApply,
  title,
  description,
  noItemsMessage,
  outsideCoverageLabel,
  cancelLabel,
  confirmLabel,
  applyingLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // The unassigned-in-view set the confirm dialog was opened for.
  items: BulkSuggestItem[]
  onPreview: (ids: string[]) => Promise<BulkSuggestionEntry[]>
  onApply: (assignments: { id: string; technician: string }[]) => Promise<void>
  title: string
  description: string
  noItemsMessage: string
  outsideCoverageLabel: string
  cancelLabel: string
  confirmLabel: string
  applyingLabel: string
}) {
  const [applying, setApplying] = React.useState(false)
  const [entries, setEntries] = React.useState<Record<string, BulkSuggestionEntry["result"]> | null>(null)
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})
  // Derived, not a separate state — true exactly while the dialog is open
  // on a non-empty batch and the preview fetch hasn't landed yet, so
  // there's no setState call needed to track it.
  const loading = open && items.length > 0 && entries === null

  // Same "adjust state during render" pattern InlineTextCell/
  // InlineGridPickerCell already use elsewhere in this app — resets the
  // preview the moment the dialog closes, rather than a setState call
  // sitting directly in an effect body.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setEntries(null)
      setOverrides({})
    }
  }

  // Fetches a fresh preview every time the dialog opens on a non-empty item
  // set — never cached across sessions, so a suggestion always reflects
  // whatever's currently unassigned rather than a stale prior run.
  React.useEffect(() => {
    if (!open || items.length === 0) return
    let cancelled = false
    onPreview(items.map((i) => i.id))
      .then((results) => {
        if (cancelled) return
        const nextEntries: Record<string, BulkSuggestionEntry["result"]> = {}
        const nextOverrides: Record<string, string> = {}
        for (const { id, result } of results) {
          nextEntries[id] = result
          nextOverrides[id] = "error" in result ? "" : result.technician
        }
        setEntries(nextEntries)
        setOverrides(nextOverrides)
      })
      .catch(() => {
        // The mutation hook itself already toasts the error — this just
        // clears the loading skeleton (entries === null) so the dialog
        // doesn't hang open forever; every row shows as unresolvable.
        if (cancelled) return
        const nextEntries: Record<string, BulkSuggestionEntry["result"]> = {}
        for (const item of items) nextEntries[item.id] = { error: "Failed to load a suggestion." }
        setEntries(nextEntries)
        setOverrides({})
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items])

  const assignableCount = items.filter((i) => (overrides[i.id] ?? "").trim()).length

  async function handleConfirm() {
    const assignments = items
      .map((i) => ({ id: i.id, technician: (overrides[i.id] ?? "").trim() }))
      .filter((a) => a.technician)
    if (assignments.length === 0) {
      onOpenChange(false)
      return
    }
    setApplying(true)
    try {
      await onApply(assignments)
      onOpenChange(false)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{items.length > 0 ? description : noItemsMessage}</DialogDescription>
        </DialogHeader>

        {items.length > 0 && (
          <div className="space-y-1">
            {!entries
              ? Array.from({ length: Math.min(items.length, 4) }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
              : items.map((item) => {
                  const result = entries[item.id]
                  const hasError = result && "error" in result
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{item.label}</div>
                        {hasError ? (
                          <div className="text-xs text-danger">{(result as { error: string }).error}</div>
                        ) : result ? (
                          <>
                            <div className="text-xs text-muted-foreground">{(result as TechnicianSuggestion).explanation}</div>
                            {(result as TechnicianSuggestion).outsideCoverage && (
                              <Badge variant="outline" className="mt-0.5 text-amber-600 border-amber-600/40">
                                {outsideCoverageLabel}
                              </Badge>
                            )}
                          </>
                        ) : null}
                      </div>
                      <div className="w-44 shrink-0">
                        {hasError ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <TechnicianCombobox
                            value={overrides[item.id] ?? ""}
                            onChange={(v) => setOverrides((old) => ({ ...old, [item.id]: v }))}
                            className="h-8 text-xs"
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {cancelLabel}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={loading || applying || (items.length > 0 && assignableCount === 0)}>
            {applying ? applyingLabel : `${confirmLabel}${items.length > 0 ? ` (${assignableCount})` : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
