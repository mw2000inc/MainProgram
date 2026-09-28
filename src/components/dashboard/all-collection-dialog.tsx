"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { format, parseISO } from "date-fns"
import { Banknote, Pencil, CheckCheck, History, Search, Calendar as CalendarIcon, ClipboardList } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { ColumnHeader } from "@/components/shared/column-header"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { InlineCurrencyCell, InlineComboboxCell, InlineTextCell, InlineDateCell } from "@/components/shared/inline-edit-cell"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { useCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useUsers } from "@/lib/hooks/use-misc"
import { useAuth } from "@/lib/auth/auth-context"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { COLLECTION_PAYMENT_TYPES } from "@/lib/constants"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatCurrency, formatDate, formatDateTime, todayIso, twoDaysFromNowIso } from "@/lib/utils"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { CollectionBreakdownDialog } from "@/components/dashboard/collection-breakdown-dialog"
import type { ComboboxOption } from "@/components/ui/combobox"

// Same presets as the Add/Edit Collection form's own PAYMENT_TYPE_OPTIONS —
// built locally from the shared COLLECTION_PAYMENT_TYPES constant rather
// than importing that form's own derived list, same "each place builds its
// own small ComboboxOption[] from a shared raw constant" precedent
// install-form-dialog.tsx's MODEL_OPTIONS already follows.
const PAYMENT_TYPE_OPTIONS: ComboboxOption[] = COLLECTION_PAYMENT_TYPES.map((v) => ({ value: v }))

type AllCollectionSource = "collection" | "install" | "repair"

// One row per real record, never summed across sources — Install/Repair
// each keep their own three sub-amount fields (plus Repair's own `amt`)
// as separate columns rather than folded into one number, per the explicit
// decision that summing loses the breakdown a Unit Price/C/P Price/
// Delivery Fee split actually carries. Most rows leave most of these
// undefined (a Collection row has no unitPrice, an Install row has no
// collectionAmount, etc.) — that sparseness is the direct, intended
// consequence of keeping the breakdown intact instead of unifying it into
// one "Amount" column.
interface AllCollectionRow {
  id: string
  source: AllCollectionSource
  recordId: string
  // Per-source "relevant date" (see each push below for which field and
  // why) — the one field driving month grouping/filtering.
  date: string
  // The resolved customer's own name when resolveCustomerForPlan finds one,
  // else the row's own raw text — used for read-only display (the table's
  // search, and AllCollectionHistoryDialog) where showing the nicer
  // resolved name is strictly better. NOT what the Customer column's inline
  // edit reads/writes — see rawName below for why those have to be kept
  // separate.
  customerDisplay: string
  // The row's own literal stored text (accountName/name — see each push
  // below) — always present regardless of resolution, and always what the
  // Customer column's InlineTextCell shows/edits. customerDisplay can't be
  // used for that: on an already-resolved row it holds the CUSTOMER
  // record's name, not this row's own field, so editing it and writing the
  // result back to accountName/name would edit a value that was never
  // actually on screen, and — since resolution is recomputed fresh from
  // customerId/orderNo on every render, never from this text — the edit
  // would then appear to silently do nothing (the resolved name would just
  // keep showing). rawName is what makes "edit this cell" and "see it
  // reflected" actually match for every row, resolved or not.
  rawName: string
  memberAccountNumber?: string
  collectionAmount?: number
  unitPrice?: number
  cpPrice?: number
  deliveryInstallationFee?: number
  repairAmt?: number
  collected: boolean
  // Who approved it and when (see the collected_audit_fields migration) —
  // collectedBy is a profiles.id, resolved to a display name at render time
  // (see adminNameById below) rather than stored as one, so a later name
  // change is never stale here.
  collectedBy?: string
  collectedAt?: string
  // Collections-only (see the collection_payment_type migration) — Install/
  // Repair rows always leave this undefined, same sparseness as the amount
  // fields above.
  paymentType?: string
}

// The three mutually exclusive ways this view's own date scope (distinct
// from dateRangeFilter above it in the header, which narrows "All Dates" vs.
// "Next 2 Days" vs. "Overdue" — this is the row underneath) can be set:
// every record regardless of date, just today, an admin-picked [from, to]
// range (inclusive both ends, see DateRangeCalendarButton below), or every
// record that falls in a given CALENDAR month regardless of which year
// ("every August," not "August 2024") — a genuinely different axis from
// "custom," which is always year-specific. Replaces the old "one pill
// button per YYYY-MM" row, which wrapped into several lines once this
// view's real data (back to 2020) accumulated enough months — a single
// popover/dropdown scales to any span instead.
export type DateScope = "all" | "today" | "custom" | "monthOnly"

// Same next2Days/all/overdue shape as DispatchApprovalQueue's own copy —
// own local copy rather than a shared cross-import, matching the "keep
// these panel files independent" precedent DispatchApprovalQueue and
// pending-approvals-panel.tsx already both follow for this exact type (see
// either file's own DateRangeFilter comment). Defaults to "all" here, not
// "next2Days" like Dispatch's own queue — All Collection is a browsable
// ledger that shows every record regardless of collected status by design
// (see its own top-level comment), so narrowing the default view to a
// 3-day window would contradict that; the option is still one click away.
export type DateRangeFilter = "all" | "next2Days" | "overdue"

function matchesDateRangeFilter(date: string, filter: DateRangeFilter): boolean {
  if (filter === "all") return true
  const today = todayIso()
  if (filter === "overdue") return date < today
  return date >= today && date <= twoDaysFromNowIso()
}

// The full active date scope this view is currently narrowed to — both
// layers (the header's dateRangeFilter AND the All/Today/custom-range/
// monthOnly row beneath it). Exported so CollectionBreakdownDialog (a
// separate view onto the SAME collections records, opened via the
// "Collection Details" badge) can filter its own rows by literally this
// same function rather than a second, separately-maintained copy of this
// logic that could silently drift out of sync with what the main table is
// actually showing.
export interface ActiveDateScopeParams {
  dateRangeFilter: DateRangeFilter
  dateScope: DateScope
  customFrom: string | undefined
  customTo: string | undefined
  monthOnlyIndex: number | undefined
}

export function matchesActiveDateScope(date: string, params: ActiveDateScopeParams): boolean {
  if (!matchesDateRangeFilter(date, params.dateRangeFilter)) return false
  if (params.dateScope === "today") return date === todayIso()
  if (params.dateScope === "custom" && params.customFrom && params.customTo) {
    return date >= params.customFrom && date <= params.customTo
  }
  if (params.dateScope === "monthOnly" && params.monthOnlyIndex != null) {
    // See scopedRows' own comment below for why this is a string slice, not
    // new Date(date).getMonth() — a timezone bug that class of parsing has
    // already been confirmed and guarded against once.
    return Number(date.slice(5, 7)) - 1 === params.monthOnlyIndex
  }
  return true
}

// Every record with a monetary field across the program, regardless of
// source table shape — Collections (a single `amount`), Install and Repair
// (Unit Price/C/P Price/Delivery Fee, plus Repair's own `amt`). Deliberately
// excludes the dormant `sales`/invoiceNumber table: confirmed live to have
// zero rows and no UI anywhere actually reads it, unlike these three.
function useAllCollectionRows(): AllCollectionRow[] {
  const { data: collections = [] } = useCollections()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()

  return React.useMemo(() => {
    // Resolves the same way every other cross-module view in this app
    // does (see customer-lookup.ts) — an explicit customerId first (only
    // Collections has one), else the order_no -> sale_list_entries bridge,
    // falling back to whatever raw name text the record was typed with
    // when neither resolves, rather than a second, fancier phone/name
    // match layer — this view's own customer column is a display
        // convenience, not a data-repair tool.
    function resolveCustomer(customerId: string | undefined, orderNo: string, rawName: string) {
      const customer = resolveCustomerForPlan(customers, saleListEntries, customerId, orderNo)
      return {
        customerDisplay: customer ? customer.companyName || customer.fullName : rawName,
        rawName,
        memberAccountNumber: customer?.memberAccountNumber || undefined,
      }
    }

    const rows: AllCollectionRow[] = []

    for (const c of collections) {
      const { customerDisplay, rawName, memberAccountNumber } = resolveCustomer(c.customerId, c.orderNo, c.accountName)
      rows.push({
        id: `collection:${c.id}`,
        source: "collection",
        recordId: c.id,
        date: c.collectionDate,
        customerDisplay,
        rawName,
        memberAccountNumber,
        collectionAmount: c.amount,
        collected: c.collected ?? false,
        collectedBy: c.collectedBy,
        collectedAt: c.collectedAt,
        paymentType: c.paymentType,
      })
    }

    for (const p of installPlans) {
      // install_plans has no customer_id column at all (see customer-lookup.ts's
      // own comment) — customerId is always undefined here, resolveCustomer
      // falls straight through to the order-number bridge.
      const { customerDisplay, rawName, memberAccountNumber } = resolveCustomer(undefined, p.orderNo, p.name)
      rows.push({
        id: `install:${p.id}`,
        source: "install",
        recordId: p.id,
        // installedDate (when the unit was actually installed, i.e. when
        // this money is really tied to) over inputDate (when the order was
        // first typed in) — falls back to inputDate only for the rare
        // record missing it. Confirmed live: all 13 real install_plans
        // rows already have installedDate set. NOTE: editing the Date
        // column always writes to installedDate specifically (see
        // DATE_FIELD_BY_SOURCE below), even on the rare row currently
        // displaying the inputDate fallback — the edit doesn't just
        // correct whichever field happened to be showing, it populates the
        // canonical field going forward.
        date: p.installedDate || p.inputDate,
        customerDisplay,
        rawName,
        memberAccountNumber,
        unitPrice: p.unitPrice,
        cpPrice: p.cpPrice,
        deliveryInstallationFee: p.deliveryInstallationFee,
        collected: p.collected ?? false,
        collectedBy: p.collectedBy,
        collectedAt: p.collectedAt,
      })
    }

    for (const r of repairPlans) {
      const { customerDisplay, rawName, memberAccountNumber } = resolveCustomer(undefined, r.orderNo, r.accountName)
      rows.push({
        id: `repair:${r.id}`,
        source: "repair",
        recordId: r.id,
        // Same reasoning as Install's installedDate above: accD
        // (accomplished date) over issuedDate (when it was logged),
        // falling back to issuedDate when blank — and the same NOTE on
        // Date edits always writing to accD specifically, even on one of
        // the 3 real repair rows currently falling back to issuedDate.
        date: r.accD || r.issuedDate,
        customerDisplay,
        rawName,
        memberAccountNumber,
        repairAmt: r.amt || undefined,
        unitPrice: r.unitPrice,
        cpPrice: r.cpPrice,
        deliveryInstallationFee: r.deliveryInstallationFee,
        collected: r.collected ?? false,
        collectedBy: r.collectedBy,
        collectedAt: r.collectedAt,
      })
    }

    // collections/installPlans/repairPlans each arrive pre-sorted ascending
    // by their OWN date column (see each list*() query), but that's three
    // separately-sorted chunks concatenated, not one merged timeline — with
    // DataTable applying no sort of its own by default, the result was collections
    // (whose own earliest date happens to be 2025-04-08) shown in full before
    // a single install/repair row (some dating back to 2024-01) ever
    // appeared. One explicit sort on the unified `date` this row actually
    // displays fixes that regardless of which source it came from.
    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }, [collections, installPlans, repairPlans, customers, saleListEntries])
}

// Every field any inline edit on this view ever writes, across all three
// tables at once — not every field exists on every table (amount/
// paymentType are Collections-only; unitPrice/cpPrice/deliveryInstallationFee
// are Install+Repair-only), but `input` here is a plain variable, not an
// object literal, at each of the three mutateAsync call sites below, so
// TypeScript only checks that whichever fields a given call actually needs
// are present and compatible — it doesn't reject the extra, irrelevant ones
// the way it would an inline literal with genuinely excess properties.
interface CollectionRecordUpdate {
  collected?: boolean
  collectedBy?: string
  collectedAt?: string
  amount?: number
  paymentType?: string
  unitPrice?: number
  cpPrice?: number
  deliveryInstallationFee?: number
  collectionDate?: string
  installedDate?: string
  accD?: string
  accountName?: string
  name?: string
}

// Dispatches an update to whichever of the three tables actually owns this
// row — all three update hooks already accept an arbitrary partial input,
// so a single shared dispatcher covers the toggle, the reassign dialog, the
// bulk-approve action, and now inline field edits, with no new mutation/API
// code.
//
// Every function this and the hooks below return has to keep the same
// identity across renders: they're dependencies of the `columns` useMemo in
// AllCollectionDialog, and a new function there rebuilds every column
// definition — which makes TanStack treat every cell as a new component and
// unmount/remount all of them (measured: every input in the table, ~2s+ per
// render at 1,000 rows). Only `mutateAsync` is taken from each mutation, not
// the mutation object itself: useMutation returns a fresh object every render,
// but its mutateAsync is bound once per mutation observer and stays stable.
function useCollectionRecordUpdaters() {
  const { mutateAsync: updateCollection } = useUpdateCollection()
  const { mutateAsync: updateInstallPlan } = useUpdateInstallPlan()
  const { mutateAsync: updateRepairPlan } = useUpdateRepairPlan()
  return React.useCallback(
    (row: Pick<AllCollectionRow, "source" | "recordId">, input: CollectionRecordUpdate) => {
      if (row.source === "collection") return updateCollection({ id: row.recordId, input })
      if (row.source === "install") return updateInstallPlan({ id: row.recordId, input })
      return updateRepairPlan({ id: row.recordId, input })
    },
    [updateCollection, updateInstallPlan, updateRepairPlan]
  )
}

// The inline-edit columns' own updater — a thin, deliberately un-audited
// wrapper (unlike useToggleCollected/useReassignCollected) since correcting
// Amount/Unit Price/etc. is a plain data fix, not an approval action; it
// never touches collected/collectedBy/collectedAt.
function useEditRecordField() {
  const update = useCollectionRecordUpdaters()
  return React.useCallback(
    (row: AllCollectionRow, field: keyof CollectionRecordUpdate, next: number | string) => update(row, { [field]: next }),
    [update]
  )
}

// Checking the Switch stamps the CURRENT admin + now as collectedBy/
// collectedAt (that's who's actually approving it, right now — never
// something a form could pre-fill or misrepresent); unchecking it ("un-
// approve") clears both rather than leaving a stale "collected by X"
// showing on a row that's no longer marked collected. Reassigning who's
// credited without touching the boolean is a separate action — see
// useReassignCollected below.
function useToggleCollected() {
  const update = useCollectionRecordUpdaters()
  const { user } = useAuth()
  return React.useCallback(
    (row: AllCollectionRow, next: boolean) => {
      update(row, {
        collected: next,
        collectedBy: next ? user?.id : "",
        collectedAt: next ? new Date().toISOString() : "",
      })
    },
    [update, user]
  )
}

// The reassign dialog's own save action — corrects who's credited and/or
// when, without flipping `collected` itself (a row has to already be
// collected to reassign its credit — see CollectedCell's own guard on
// showing the edit affordance at all).
function useReassignCollected() {
  const update = useCollectionRecordUpdaters()
  return React.useCallback(
    async (row: AllCollectionRow, collectedBy: string, collectedAt: string) => {
      await update(row, { collectedBy, collectedAt })
    },
    [update]
  )
}

// Approves every not-yet-collected row in the given set, one at a time
// (same sequential-await shape DispatchApprovalQueue's own Approve All
// uses) — already-collected rows are left untouched so their real,
// original collectedBy/collectedAt is never overwritten by a bulk action
// that didn't actually approve them.
function useBulkApproveCollected() {
  const update = useCollectionRecordUpdaters()
  const { user } = useAuth()
  return React.useCallback(
    async (rows: AllCollectionRow[]) => {
      const collectedAt = new Date().toISOString()
      for (const row of rows) {
        if (row.collected) continue
        await update(row, { collected: true, collectedBy: user?.id, collectedAt })
      }
    },
    [update, user]
  )
}

const ALL_COLLECTION_PAGE_SIZE = 50

const SOURCE_MODULE_KEYS: Record<AllCollectionSource, string> = {
  collection: "collectionModule",
  install: "installationModule",
  repair: "repairModule",
}

// Which underlying column the Date cell actually writes to, per source —
// always this field, even on a row currently *displaying* the other
// fallback (inputDate/issuedDate) because its own primary field is blank.
// See each push in useAllCollectionRows for the full reasoning.
const DATE_FIELD_BY_SOURCE: Record<AllCollectionSource, keyof CollectionRecordUpdate> = {
  collection: "collectionDate",
  install: "installedDate",
  repair: "accD",
}

// Which underlying column the Customer cell's raw-text edit writes to.
const NAME_FIELD_BY_SOURCE: Record<AllCollectionSource, keyof CollectionRecordUpdate> = {
  collection: "accountName",
  install: "name",
  repair: "accountName",
}


function amountSummary(row: AllCollectionRow): string {
  const parts: string[] = []
  if (row.collectionAmount != null) parts.push(formatCurrency(row.collectionAmount))
  if (row.unitPrice != null) parts.push(formatCurrency(row.unitPrice))
  if (row.cpPrice != null) parts.push(formatCurrency(row.cpPrice))
  if (row.deliveryInstallationFee != null) parts.push(formatCurrency(row.deliveryInstallationFee))
  if (row.repairAmt != null) parts.push(formatCurrency(row.repairAmt))
  return parts.length > 0 ? parts.join(" + ") : "—"
}

// All Collection's own approval history — deliberately NOT
// DispatchHistoryDialog: that dialog is a log of dispatch_notifications
// (SMS/email sends for the schedule-confirmation workflow), a completely
// different concern from "who marked a payment Collected, and when."
// Reusing it here would show the wrong data entirely. This instead reads
// straight off the same rows already loaded for the table (collectedBy/
// collectedAt, from the collected_audit_fields migration) — no separate
// history table or fetch needed, since that audit trail already *is* the
// history. Same visual shape (search + card list, same empty states) as
// DispatchHistoryDialog for consistency, just backed by this view's own
// real data instead of a parallel mechanism.
function AllCollectionHistoryDialog({
  open,
  onOpenChange,
  rows,
  adminNameById,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: AllCollectionRow[]
  adminNameById: Map<string, string>
}) {
  const { t } = useTranslation("allCollection")
  const { t: tDispatch } = useTranslation("dispatch")
  const [search, setSearch] = React.useState("")

  const collectedRows = React.useMemo(
    () => rows.filter((r) => r.collected).sort((a, b) => (b.collectedAt ?? "").localeCompare(a.collectedAt ?? "")),
    [rows]
  )

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return collectedRows
    return collectedRows.filter(
      (r) =>
        r.customerDisplay.toLowerCase().includes(q) ||
        tDispatch(SOURCE_MODULE_KEYS[r.source]).toLowerCase().includes(q)
    )
  }, [collectedRows, search, tDispatch])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("historyTitle")}</DialogTitle>
          <DialogDescription>{t("historyDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder={t("historySearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {filteredRows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {collectedRows.length === 0 ? t("noHistoryYet") : t("noHistoryMatches")}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredRows.map((row) => (
              <div key={row.id} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{tDispatch(SOURCE_MODULE_KEYS[row.source])}</Badge>
                  <span className="font-medium truncate">{row.customerDisplay}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(row.date)} · {amountSummary(row)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("collectedByLine", {
                    name: row.collectedBy ? adminNameById.get(row.collectedBy) ?? t("unknownAdmin") : t("unknownAdmin"),
                    date: row.collectedAt ? formatDateTime(row.collectedAt) : "—",
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Edits row.rawName (this record's own stored accountName/name), never
// row.customerDisplay — see AllCollectionRow's own comment on why those two
// have to stay separate now that this cell is actually editable. The
// member-account line underneath is untouched by this edit: it's still the
// same resolveCustomerForPlan result as before, driven by customerId/
// orderNo, not by this text — typing a correction here doesn't re-link the
// row to a different customer, exactly as scoped.
function CustomerCell({ row, onCommit }: { row: AllCollectionRow; onCommit: (next: string) => void }) {
  const { t } = useTranslation("allCollection")
  return (
    <div className="min-w-0 space-y-1">
      <InlineTextCell value={row.rawName} onCommit={onCommit} className="w-full min-w-[140px]" />
      {row.memberAccountNumber ? (
        <p className="font-mono text-xs text-muted-foreground">{row.memberAccountNumber}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("noMemberMatch")}</p>
      )}
    </div>
  )
}

// Reassigning credit (who's credited, and when) used to open a separate
// Dialog stacked on top of AllCollectionDialog — a modal-on-modal that took
// the admin away from the row they were looking at. Now it's two plain
// inline controls, right in the row, matching every other editable field in
// this table: an admin Select (a closed, known list — unlike Payment
// Type's Combobox, no free text makes sense here) and an InlineDateCell,
// each committing immediately on change/blur, same as Amount/Date/
// Customer/etc. already do. Only shown once collected — reassigning credit
// for a row that isn't actually marked Collected doesn't make sense.
function CollectedCell({
  row,
  admins,
  onToggle,
  onReassign,
}: {
  row: AllCollectionRow
  admins: { id: string; name: string }[]
  onToggle: (next: boolean) => void
  onReassign: (collectedBy: string, collectedAt: string) => void
}) {
  const { t } = useTranslation("allCollection")
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch checked={row.collected} onCheckedChange={onToggle} size="sm" />
        <Badge
          variant="outline"
          className={cn(
            "font-normal",
            row.collected ? "bg-success/10 text-success border-success/20" : "text-muted-foreground"
          )}
        >
          {row.collected ? t("collected") : t("notCollected")}
        </Badge>
      </div>
      {row.collected && (
        <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Select
            value={row.collectedBy ?? ""}
            onValueChange={(next) => onReassign(next, row.collectedAt ?? "")}
          >
            <SelectTrigger className="h-6 w-[130px] text-[11px]">
              <SelectValue placeholder={t("unknownAdmin")} />
            </SelectTrigger>
            <SelectContent>
              {admins.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <InlineDateCell
            value={row.collectedAt?.slice(0, 10)}
            onCommit={(next) => onReassign(row.collectedBy ?? "", next)}
            className="h-6 w-[120px] text-[11px]"
          />
        </div>
      )}
    </div>
  )
}

// English month names regardless of the app's own EN/KO toggle — matching
// InlineDateCell's own DATE_PICKER_MONTH_NAMES precedent for the exact same
// need (fast navigation to a date years in the past — this view's real data
// goes back to 2020, so prev/next-arrow-only paging would be unusable).
// Exported so CollectionBreakdownDialog's own CSV export can name a
// monthOnly-scoped file "August_All_Years" using the same month names this
// file's own dropdown already shows, rather than a second, separately-
// maintained copy.
export const DATE_RANGE_MONTH_NAMES = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMMM"))

// The custom-range replacement for the old per-month pill row: a single
// Popover + range-mode Calendar. ui/calendar.tsx already ships full
// range_start/range_middle/range_end styling (react-day-picker's own),
// simply never exercised anywhere in this app until now, so this needed no
// new CSS. Same Popover+Calendar+Month/Year-select shell as InlineDateCell
// (see that component's own comment for why the Selects exist instead of
// react-day-picker's built-in captionLayout="dropdown"), just with
// mode="range"/a {from,to} selection instead of a single day — the first
// click sets `from` (with `to` still unset), the second sets `to`, even
// after navigating to a different month in between; the popover only closes
// once both ends are picked, exactly like InlineDateCell closes once its
// own single pick completes.
function DateRangeCalendarButton({
  from,
  to,
  active,
  onChange,
  placeholder,
}: {
  from: string | undefined
  to: string | undefined
  active: boolean
  onChange: (from: string | undefined, to: string | undefined) => void
  placeholder: string
}) {
  const [open, setOpen] = React.useState(false)
  const selectedFrom = from ? parseISO(from) : undefined
  const selectedTo = to ? parseISO(to) : undefined
  const [viewMonth, setViewMonth] = React.useState(() => selectedFrom ?? new Date())
  // Tracks a genuinely in-progress pick — confirmed live that react-day-picker's
  // range mode reports {from: day, to: day} on the very FIRST click of a
  // fresh selection (not {from: day, to: undefined}, which is what a naive
  // "close once both ends are set" check would assume). Without this, the
  // popover closed after exactly one click, silently turning "Aug 10 to Aug
  // 20" into a false one-day range the moment the admin clicked Aug 10.
  const [pendingFrom, setPendingFrom] = React.useState<Date | undefined>(undefined)

  const yearOptions = React.useMemo(() => {
    const year = new Date().getFullYear()
    return Array.from({ length: 21 }, (_, i) => year - 10 + i)
  }, [])
  const calendarBounds = React.useMemo(
    () => ({ startMonth: new Date(yearOptions[0], 0), endMonth: new Date(yearOptions[yearOptions.length - 1], 11) }),
    [yearOptions]
  )

  function handleOpenChange(next: boolean) {
    if (next) setViewMonth(selectedFrom ?? new Date())
    setPendingFrom(undefined)
    setOpen(next)
  }

  const label = from && to ? `${format(parseISO(from), "MM/dd/yyyy")} - ${format(parseISO(to), "MM/dd/yyyy")}` : placeholder

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant={active ? "default" : "outline"} className="h-7 gap-1.5 font-normal">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        // Same guard InlineDateCell's own PopoverContent uses, for the same
        // reason: the Month/Year Selects' own open listbox portals to
        // document.body too, so a click inside it would otherwise register
        // as "outside" this popover and close the whole calendar before the
        // selection applies.
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-slot="select-content"]') || target?.closest('[role="listbox"]')) {
            event.preventDefault()
          }
        }}
      >
        <div className="flex items-center gap-1.5 border-b p-2">
          <Select value={String(viewMonth.getMonth())} onValueChange={(v) => setViewMonth((d) => new Date(d.getFullYear(), Number(v), 1))}>
            <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
              <SelectValue>{DATE_RANGE_MONTH_NAMES[viewMonth.getMonth()]}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-48">
              {DATE_RANGE_MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(viewMonth.getFullYear())} onValueChange={(v) => setViewMonth((d) => new Date(Number(v), d.getMonth(), 1))}>
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
          mode="range"
          selected={{ from: selectedFrom, to: selectedTo }}
          month={viewMonth}
          onMonthChange={setViewMonth}
          startMonth={calendarBounds.startMonth}
          endMonth={calendarBounds.endMonth}
          classNames={{ month_caption: "hidden" }}
          onSelect={(range) => {
            // The very first click of a fresh pick reports {from: day, to:
            // day} — treat that as ONLY setting the start, not a complete
            // one-day range, so a second click is still needed for the end
            // (see pendingFrom's own comment above for why this matters).
            const isFirstClickOfFreshPick =
              !pendingFrom && range?.from && range.to && range.from.getTime() === range.to.getTime()
            if (isFirstClickOfFreshPick) {
              setPendingFrom(range.from)
              onChange(format(range.from!, "yyyy-MM-dd"), undefined)
              return
            }
            const nextFrom = range?.from ? format(range.from, "yyyy-MM-dd") : undefined
            const nextTo = range?.to ? format(range.to, "yyyy-MM-dd") : undefined
            onChange(nextFrom, nextTo)
            setPendingFrom(undefined)
            if (nextFrom && nextTo) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

// Admin-only cross-module payments view (Daily Report header, alongside
// Pending Dispatch/Inventory Approval and Daily Report Approvals) — every
// monetary record in the program in one place, date-filterable, with an
// explicit admin-set Collected flag per row. Dialog shape (fullscreen
// toggle, Escape handling) mirrors DispatchApprovalQueue exactly; the date
// scope row (All/Today/a custom range) sits as a horizontal row rather than
// a tall sidebar — this is a Dialog, not a full page, so there's no
// equivalent bounded-height column to put a sidebar in.
export function AllCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("allCollection")
  const { t: tCommon } = useTranslation("common")
  const { t: tDispatch } = useTranslation("dispatch")
  const rows = useAllCollectionRows()
  const toggleCollected = useToggleCollected()
  const reassignCollected = useReassignCollected()
  const bulkApproveCollected = useBulkApproveCollected()
  const editField = useEditRecordField()
  const { data: users = [] } = useUsers()
  // Same cached queries useAllCollectionRows() already reads internally
  // (same query keys — this doesn't trigger a second fetch) — needed here
  // too so the pencil action can open that record's OWN full edit dialog
  // with the real record, not the flattened AllCollectionRow display shape.
  const { data: collections = [] } = useCollections()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: repairPlans = [] } = useRepairPlans()
  // Which row's "everything inline editing doesn't cover" dialog is open —
  // Address/Note/Model/Status/etc., genuinely different per source, so this
  // opens that source's own already-built Add/Edit form (in edit mode) right
  // on top of this dialog instead of navigating away from it. Saving there
  // already invalidates the same query useAllCollectionRows() reads, so this
  // table picks up the change with no extra plumbing.
  const [editingRow, setEditingRow] = React.useState<AllCollectionRow | undefined>(undefined)
  const editingCollection = editingRow?.source === "collection" ? collections.find((c) => c.id === editingRow.recordId) : undefined
  const editingInstall = editingRow?.source === "install" ? installPlans.find((p) => p.id === editingRow.recordId) : undefined
  const editingRepair = editingRow?.source === "repair" ? repairPlans.find((p) => p.id === editingRow.recordId) : undefined
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  const [dateScope, setDateScope] = React.useState<DateScope>("all")
  // Only meaningful once dateScope is "custom" — both set together (see
  // DateRangeCalendarButton's own onChange below), and picking All/Today
  // doesn't clear them, so re-opening the range popover afterward still
  // shows whatever range was last picked rather than starting blank.
  const [customFrom, setCustomFrom] = React.useState<string | undefined>(undefined)
  const [customTo, setCustomTo] = React.useState<string | undefined>(undefined)
  // Only meaningful once dateScope is "monthOnly" — a plain 0-11 index
  // (January=0), same convention Date.getMonth() uses, matching how this
  // filter was specified; not cleared by picking All/Today/a custom range,
  // same "remembers the last pick" reasoning customFrom/customTo above has.
  const [monthOnlyIndex, setMonthOnlyIndex] = React.useState<number | undefined>(undefined)
  const [dateRangeFilter, setDateRangeFilter] = React.useState<DateRangeFilter>("all")
  // Independent of every date-scope control above — an admin hunting for
  // what's still outstanding wants this to stay engaged while they browse
  // different ranges, not reset every time dateScope does. Toggling a badge
  // twice (or the other one) clears back to "all".
  const [collectedFilter, setCollectedFilter] = React.useState<"all" | "collected" | "notCollected">("all")
  const [confirmBulkApprove, setConfirmBulkApprove] = React.useState(false)
  const [bulkApproving, setBulkApproving] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [breakdownOpen, setBreakdownOpen] = React.useState(false)

  React.useEffect(() => {
    if (!open) exitFullScreen()
  }, [open, exitFullScreen])

  const admins = React.useMemo(() => users.filter((u) => u.role === "admin"), [users])
  const adminNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  // The coarse top-level scope (matching DispatchApprovalQueue's own date-
  // range dropdown) — the All/Today/custom-range row below then narrows
  // *within* whatever this leaves, same as Dispatch's own list rendering
  // inside its filter.
  const dateRangeRows = React.useMemo(
    () => rows.filter((r) => matchesDateRangeFilter(r.date, dateRangeFilter)),
    [rows, dateRangeFilter]
  )

  // Counted from dateRangeRows (the same top-level scope scopedRows below
  // also derives from), not the full unfiltered `rows` — so this stays
  // consistent with whatever the Next 2 Days/Overdue dropdown is currently
  // set to, exactly like every other tab in this same row.
  const todayCount = React.useMemo(() => {
    const today = todayIso()
    return dateRangeRows.filter((r) => r.date === today).length
  }, [dateRangeRows])

  // Derived straight from `rows` via the shared matchesActiveDateScope
  // (which already re-checks dateRangeFilter itself) rather than filtering
  // dateRangeRows a second time — this is also the exact predicate
  // CollectionBreakdownDialog applies to its own collections rows, so the
  // two views can never silently disagree about what "the current date
  // scope" means.
  const scopedRows = React.useMemo(
    () => rows.filter((r) => matchesActiveDateScope(r.date, { dateRangeFilter, dateScope, customFrom, customTo, monthOnlyIndex })),
    [rows, dateRangeFilter, dateScope, customFrom, customTo, monthOnlyIndex]
  )

  // Bulk-approve stays scoped to a deliberately bounded window, same as
  // before this replaced the old "drill into one specific day" pills — now
  // "a custom range is picked" plays that same role instead of "a single
  // day," rather than being offered for "All" (unbounded, too easy to
  // blanket-approve records never actually reviewed) or "Today."
  const uncollectedInDay = React.useMemo(() => scopedRows.filter((r) => !r.collected), [scopedRows])
  // Collected/Not Collected summary badges' own counts — deliberately from
  // scopedRows (the current date/month/day scope), NOT the collected-filtered
  // result below, so neither count collapses to 0 once its own badge is
  // toggled on; uncollectedInDay above is exactly the "Not Collected" count
  // already, reused rather than recomputed.
  const collectedInScope = React.useMemo(() => scopedRows.filter((r) => r.collected), [scopedRows])

  // The actual table data — scopedRows narrowed one step further by the
  // Collected/Not Collected toggle.
  const displayedRows = React.useMemo(() => {
    if (collectedFilter === "all") return scopedRows
    return scopedRows.filter((r) => (collectedFilter === "collected" ? r.collected : !r.collected))
  }, [scopedRows, collectedFilter])

  const columns = React.useMemo<ColumnDef<AllCollectionRow, unknown>[]>(
    () => [
      {
        accessorKey: "date",
        header: () => <ColumnHeader tKey="dateColumn" ns="allCollection" />,
        // Always writes to the canonical field for this source
        // (DATE_FIELD_BY_SOURCE) — collectionDate/installedDate/accD —
        // regardless of whether row.date is currently showing that field's
        // own value or its fallback (inputDate/issuedDate). See each push
        // in useAllCollectionRows for why that's the right target even then.
        cell: ({ row }) => (
          <InlineDateCell
            value={row.original.date}
            onCommit={(next) => editField(row.original, DATE_FIELD_BY_SOURCE[row.original.source], next)}
          />
        ),
        // Explicit real-date comparison rather than relying on TanStack's
        // own auto-detected sortingFn — the underlying value is already a
        // sortable ISO "YYYY-MM-DD" string (not the formatted display
        // text), but making the comparison explicit here removes any doubt
        // clicking this header actually sorts chronologically.
        sortingFn: (a, b) => new Date(a.original.date).getTime() - new Date(b.original.date).getTime(),
      },
      {
        id: "customer",
        header: () => <ColumnHeader tKey="customerColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <CustomerCell
            row={row.original}
            onCommit={(next) => editField(row.original, NAME_FIELD_BY_SOURCE[row.original.source], next)}
          />
        ),
      },
      {
        id: "source",
        header: () => <ColumnHeader tKey="sourceColumn" ns="allCollection" />,
        cell: ({ row }) => <Badge variant="secondary">{tDispatch(SOURCE_MODULE_KEYS[row.original.source])}</Badge>,
      },
      {
        accessorKey: "collectionAmount",
        header: () => <ColumnHeader tKey="amount" ns="fields" />,
        // Collections-only field — Install/Repair rows always leave this
        // undefined (see AllCollectionRow's own comment), so they fall back
        // to the same plain "—" as before rather than an edit control for a
        // field that doesn't apply to them.
        cell: ({ row }) =>
          row.original.source === "collection" ? (
            <InlineCurrencyCell
              value={row.original.collectionAmount ?? 0}
              onCommit={(next) => editField(row.original, "amount", next)}
            />
          ) : row.original.collectionAmount != null ? (
            formatCurrency(row.original.collectionAmount)
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "paymentType",
        header: () => <ColumnHeader tKey="paymentType" ns="fields" />,
        cell: ({ row }) =>
          row.original.source === "collection" ? (
            <InlineComboboxCell
              value={row.original.paymentType}
              options={PAYMENT_TYPE_OPTIONS}
              placeholder="—"
              onCommit={(next) => editField(row.original, "paymentType", next)}
            />
          ) : (
            row.original.paymentType || "—"
          ),
      },
      {
        accessorKey: "unitPrice",
        header: () => <ColumnHeader tKey="unitPrice" ns="fields" />,
        // Install+Repair only — Collections has no such field at all.
        cell: ({ row }) =>
          row.original.source !== "collection" ? (
            <InlineCurrencyCell
              value={row.original.unitPrice ?? 0}
              onCommit={(next) => editField(row.original, "unitPrice", next)}
            />
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "cpPrice",
        header: () => <ColumnHeader tKey="cpPrice" ns="fields" />,
        cell: ({ row }) =>
          row.original.source !== "collection" ? (
            <InlineCurrencyCell
              value={row.original.cpPrice ?? 0}
              onCommit={(next) => editField(row.original, "cpPrice", next)}
            />
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "deliveryInstallationFee",
        header: () => <ColumnHeader tKey="deliveryInstallationFee" ns="fields" />,
        cell: ({ row }) =>
          row.original.source !== "collection" ? (
            <InlineCurrencyCell
              value={row.original.deliveryInstallationFee ?? 0}
              onCommit={(next) => editField(row.original, "deliveryInstallationFee", next)}
            />
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "repairAmt",
        header: () => <ColumnHeader tKey="amt" ns="fields" />,
        cell: ({ row }) => (row.original.repairAmt != null ? formatCurrency(row.original.repairAmt) : "—"),
      },
      {
        id: "collected",
        header: () => <ColumnHeader tKey="collectedColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <CollectedCell
            row={row.original}
            admins={admins}
            onToggle={(next) => toggleCollected(row.original, next)}
            onReassign={(collectedBy, collectedAt) => reassignCollected(row.original, collectedBy, collectedAt)}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        // Opens that record's own full edit dialog (CollectionsFormDialog/
        // InstallFormDialog/RepairFormDialog, rendered below) right on top of
        // this one, for the fields inline editing here doesn't cover (Model,
        // Address, Note, etc.) — not a duplicate of inline editing, which
        // already handles Amount/Payment Type/Unit Price/C-P Price/Delivery
        // Fee/Date/Customer/Collected directly in this table. Deliberately
        // no navigation and no closing this dialog: closing the edit dialog
        // (Cancel or Save) leaves the admin right back where they were,
        // scroll position and month/day filters intact. stopPropagation
        // guards against a future onRowClick this table doesn't have today,
        // same defensive convention every other row-action button here follows.
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              setEditingRow(row.original)
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [tDispatch, toggleCollected, admins, reassignCollected, editField]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          isFullScreen
            ? "inset-0 top-0 left-0 h-screen max-h-screen w-screen max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-6"
            : "sm:max-w-5xl max-h-[80vh]",
          "overflow-y-auto flex flex-col"
        )}
        onEscapeKeyDown={(e) => {
          if (isFullScreen) {
            e.preventDefault()
            exitFullScreen()
          }
        }}
        // The pencil action's own edit dialog (CollectionsFormDialog/
        // InstallFormDialog/RepairFormDialog, rendered below) is a SEPARATE
        // Radix Dialog, portaled outside this one's own DOM subtree — a
        // click on ANYTHING inside it (its own X button, its own Cancel
        // button, anywhere in its own content) registers as "outside" this
        // dialog's content too, a known nested-Dialog gotcha, since Radix's
        // outside-pointerdown detection only checks "was this outside MY OWN
        // content," not "is there another dialog's content in the way."
        // Escape doesn't have this problem (Radix's own layer stack already
        // scopes it to the topmost dialog only — confirmed empirically
        // before adding this at all), so only pointerdown needs the same
        // "target is inside some OTHER dialog" guard the Maximize2 nested-
        // dialog fix already uses elsewhere in this app.
        onPointerDownOutside={(e) => {
          const target = e.detail.originalEvent.target
          if (target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]')) e.preventDefault()
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-primary" /> {t("title")}
            </span>
            <div className="flex items-center gap-2">
              <Select value={dateRangeFilter} onValueChange={(v) => setDateRangeFilter(v as DateRangeFilter)}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="next2Days">{tDispatch("next2DaysFilter")}</SelectItem>
                  <SelectItem value="all">{tDispatch("allDatesFilter")}</SelectItem>
                  <SelectItem value="overdue">{tDispatch("overdueFilter")}</SelectItem>
                </SelectContent>
              </Select>
              <FullScreenToggleButton isFullScreen={isFullScreen} onToggle={toggleFullScreen} />
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 font-normal"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="h-3.5 w-3.5" /> {tDispatch("historyButton")}
              </Button>
            </div>
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="shrink-0 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={dateScope === "all" ? "default" : "outline"}
            className="h-7 gap-1.5"
            onClick={() => setDateScope("all")}
          >
            {tCommon("all")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={dateScope === "today" ? "default" : "outline"}
            className="h-7 gap-1.5"
            onClick={() => setDateScope("today")}
          >
            {tCommon("today")} <Badge variant="secondary" className="ml-0.5">{todayCount}</Badge>
          </Button>
          {/* Replaces the old per-month pill row (and the day-pills row that
              used to sit beneath it) with one popover: pick any inclusive
              [from, to] range instead of only a whole calendar month, with
              no upper bound on how far apart this view's real data (back to
              2020) can span without ever wrapping into multiple lines. */}
          <DateRangeCalendarButton
            from={customFrom}
            to={customTo}
            active={dateScope === "custom"}
            placeholder={t("selectDateRangePlaceholder")}
            onChange={(from, to) => {
              setCustomFrom(from)
              setCustomTo(to)
              if (from && to) setDateScope("custom")
            }}
          />
          {/* A genuinely different axis from the range picker above — "every
              August across every year," not "August of one specific year."
              Independent state (monthOnlyIndex), so switching to this and
              back to a custom range doesn't clobber either one's own last
              pick. */}
          <Select
            value={dateScope === "monthOnly" && monthOnlyIndex != null ? String(monthOnlyIndex) : ""}
            onValueChange={(v) => {
              setMonthOnlyIndex(Number(v))
              setDateScope("monthOnly")
            }}
          >
            <SelectTrigger className={cn("h-7 w-40 text-xs", dateScope === "monthOnly" && "border-primary")}>
              <SelectValue placeholder={t("selectMonthOnlyPlaceholder")}>
                {dateScope === "monthOnly" && monthOnlyIndex != null
                  ? t("monthOnlySelectedLabel", { month: DATE_RANGE_MONTH_NAMES[monthOnlyIndex] })
                  : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Bulk-approve stays scoped to a deliberately bounded window (a
              custom range), same as it was previously scoped to "a single
              drilled-into day" — never offered for "All" (unbounded),
              "Today" (no explicit review step behind it), or "monthOnly"
              (can span years of records — not the same kind of deliberately
              narrow window a specific range or day was), unchanged from
              before. */}
          {dateScope === "custom" && uncollectedInDay.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 ml-1.5"
              disabled={bulkApproving}
              onClick={() => setConfirmBulkApprove(true)}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("bulkApproveDayCount", { count: String(uncollectedInDay.length) })}
            </Button>
          )}
        </div>

        <div className={cn("flex-1 min-h-0", isFullScreen ? "flex flex-col" : undefined)}>
          <DataTable
            columns={columns}
            data={displayedRows}
            // 50 rows per page, not DataTable's show-everything default: every
            // row here carries ~8 inline-edit controls, so mounting all ~1,000
            // at once put ~35k DOM nodes on the page (multi-second open, laggy
            // typing). "All rows" is still one click away in the footer, and
            // search still filters the full dataset before it's paged.
            pageSize={ALL_COLLECTION_PAGE_SIZE}
            // Saving an inline edit refetches (new `data` identity); without
            // this the table would bounce back to page 1 on every save. The
            // page now only resets when the scope pills below (or the
            // Collected/Not Collected toggle) change.
            pageResetKey={`${dateRangeFilter}|${dateScope}|${customFrom ?? ""}|${customTo ?? ""}|${collectedFilter}`}
            searchPlaceholder={t("searchPlaceholder")}
            emptyMessage={t("noRecordsFound")}
            tableContainerClassName="scrollbar-always-visible"
            tableClassName="min-w-max"
            scrollContainerClassName={isFullScreen ? undefined : "overflow-y-visible"}
            // Same Button+inner-count-Badge shape the month/day scope pills
            // above already use — clicking the active one again clears back
            // to "all" (a toggle, not a one-way radio), so an admin never
            // gets stuck unable to see everything again without hunting for
            // a separate "clear" control.
            toolbar={
              <>
                <Button
                  type="button"
                  size="sm"
                  variant={collectedFilter === "collected" ? "default" : "outline"}
                  className="h-8 gap-1.5"
                  onClick={() => setCollectedFilter((prev) => (prev === "collected" ? "all" : "collected"))}
                >
                  {t("collected")} <Badge variant="secondary" className="ml-0.5">{collectedInScope.length}</Badge>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={collectedFilter === "notCollected" ? "default" : "outline"}
                  className="h-8 gap-1.5"
                  onClick={() => setCollectedFilter((prev) => (prev === "notCollected" ? "all" : "notCollected"))}
                >
                  {t("notCollected")} <Badge variant="secondary" className="ml-0.5">{uncollectedInDay.length}</Badge>
                </Button>
                {/* Opens CollectionBreakdownDialog — a separate cash/cheque
                    reconciliation view over collections records specifically
                    (see that dialog's own comment for why it's Collections-
                    only), scoped to this SAME active date filter. */}
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setBreakdownOpen(true)}>
                  <ClipboardList className="h-3.5 w-3.5" /> {t("collectionDetailsBadge")}
                </Button>
              </>
            }
          />
        </div>
      </DialogContent>

      {/* Full, unfiltered `rows` — not scopedRows/dateRangeRows — same as
          DispatchHistoryDialog showing its own full history independent of
          DispatchApprovalQueue's own date-range filter. This is "everything
          ever collected," not "whatever the table happens to be showing
          right now." */}
      <AllCollectionHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        rows={rows}
        adminNameById={adminNameById}
      />

      <CollectionBreakdownDialog
        open={breakdownOpen}
        onOpenChange={setBreakdownOpen}
        dateRangeFilter={dateRangeFilter}
        dateScope={dateScope}
        customFrom={customFrom}
        customTo={customTo}
        monthOnlyIndex={monthOnlyIndex}
      />

      <ConfirmDialog
        open={confirmBulkApprove}
        onOpenChange={setConfirmBulkApprove}
        title={t("bulkApproveConfirmTitle")}
        description={t("bulkApproveConfirmDescription", {
          count: String(uncollectedInDay.length),
          range: customFrom && customTo ? `${formatDate(customFrom)} - ${formatDate(customTo)}` : "",
        })}
        confirmLabel={tCommon("approve")}
        destructive={false}
        loading={bulkApproving}
        onConfirm={async () => {
          setBulkApproving(true)
          try {
            await bulkApproveCollected(uncollectedInDay)
            setConfirmBulkApprove(false)
          } finally {
            setBulkApproving(false)
          }
        }}
      />

      {/* The pencil action's own dialog — whichever one source's `entry`/
          `plan` is actually set (see editingCollection/editingInstall/
          editingRepair above) opens; the other two stay closed. Each of
          these already has its own onInteractOutside guard against a
          backdrop click closing it early, same as every other dialog nested
          inside another one in this app. defaultDate is inert here (always
          overridden the moment `entry`/`plan` is set — see each dialog's own
          defaultValues) but still required by their shared prop shape. */}
      <CollectionsFormDialog
        open={!!editingCollection}
        onOpenChange={(o) => !o && setEditingRow(undefined)}
        defaultDate={todayIso()}
        entry={editingCollection}
      />
      <InstallFormDialog
        open={!!editingInstall}
        onOpenChange={(o) => !o && setEditingRow(undefined)}
        defaultDate={todayIso()}
        plan={editingInstall}
      />
      <RepairFormDialog
        open={!!editingRepair}
        onOpenChange={(o) => !o && setEditingRow(undefined)}
        defaultDate={todayIso()}
        plan={editingRepair}
      />
    </Dialog>
  )
}
