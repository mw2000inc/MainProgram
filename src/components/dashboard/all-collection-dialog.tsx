"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { Banknote, Pencil, CheckCheck, History, Search } from "lucide-react"
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

function yearMonth(dateStr: string) {
  return dateStr.slice(0, 7)
}

// Same next2Days/all/overdue shape as DispatchApprovalQueue's own copy —
// own local copy rather than a shared cross-import, matching the "keep
// these panel files independent" precedent DispatchApprovalQueue and
// pending-approvals-panel.tsx already both follow for this exact type (see
// either file's own DateRangeFilter comment). Defaults to "all" here, not
// "next2Days" like Dispatch's own queue — All Collection is a browsable
// ledger that shows every record regardless of collected status by design
// (see its own top-level comment), so narrowing the default view to a
// 3-day window would contradict that; the option is still one click away.
type DateRangeFilter = "all" | "next2Days" | "overdue"

function matchesDateRangeFilter(date: string, filter: DateRangeFilter): boolean {
  if (filter === "all") return true
  const today = todayIso()
  if (filter === "overdue") return date < today
  return date >= today && date <= twoDaysFromNowIso()
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

// Where the Edit action column's button sends the admin — the standalone
// list page each row's own record actually lives on, all three of which
// already support a ?id= deep link straight to that specific record (see
// each page's own initialId/initialGroupId resolution). This is for the
// fields inline editing here deliberately doesn't cover (Model, Address,
// Note, etc.) — inline editing handles Amount/Payment Type/Unit Price/C-P
// Price/Delivery Fee/Date/Customer directly in this table already.
const RECORD_PAGE_PATH_BY_SOURCE: Record<AllCollectionSource, string> = {
  collection: "/collection-plan",
  install: "/install",
  repair: "/repair-plan",
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

// Admin-only cross-module payments view (Daily Report header, alongside
// Pending Dispatch/Inventory Approval and Daily Report Approvals) — every
// monetary record in the program in one place, month-filterable, with an
// explicit admin-set Collected flag per row. Dialog shape (fullscreen
// toggle, Escape handling) mirrors DispatchApprovalQueue exactly; the
// month filter reuses the same monthGroups/selectedMonth logic Filter
// Change/Collection Plan's own list pages already use, as a horizontal
// button row rather than a tall sidebar — this is a Dialog, not a full
// page, so there's no equivalent bounded-height column to put a sidebar in.
export function AllCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const { t } = useTranslation("allCollection")
  const { t: tCommon } = useTranslation("common")
  const { t: tDispatch } = useTranslation("dispatch")
  const rows = useAllCollectionRows()
  const toggleCollected = useToggleCollected()
  const reassignCollected = useReassignCollected()
  const bulkApproveCollected = useBulkApproveCollected()
  const editField = useEditRecordField()
  const { data: users = [] } = useUsers()
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  // Only ever meaningful within a selected month (see dayGroups below) —
  // reset the instant the month itself changes, so a stale day from a
  // previous month can never silently keep filtering the new one.
  const [selectedDay, setSelectedDay] = React.useState<string | undefined>(undefined)
  const [dateRangeFilter, setDateRangeFilter] = React.useState<DateRangeFilter>("all")
  const [confirmBulkApprove, setConfirmBulkApprove] = React.useState(false)
  const [bulkApproving, setBulkApproving] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)

  React.useEffect(() => {
    if (!open) exitFullScreen()
  }, [open, exitFullScreen])

  const admins = React.useMemo(() => users.filter((u) => u.role === "admin"), [users])
  const adminNameById = React.useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])

  // The coarse top-level scope (matching DispatchApprovalQueue's own date-
  // range dropdown) — month/day pills below then narrow *within* whatever
  // this leaves, same as Dispatch's own list rendering inside its filter.
  const dateRangeRows = React.useMemo(
    () => rows.filter((r) => matchesDateRangeFilter(r.date, dateRangeFilter)),
    [rows, dateRangeFilter]
  )

  const monthGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of dateRangeRows) counts.set(yearMonth(r.date), (counts.get(yearMonth(r.date)) ?? 0) + 1)
    return Array.from(counts, ([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))
  }, [dateRangeRows])

  const monthRows = React.useMemo(() => {
    if (selectedMonth === "all") return dateRangeRows
    return dateRangeRows.filter((r) => yearMonth(r.date) === selectedMonth)
  }, [dateRangeRows, selectedMonth])

  // Same computation as monthGroups above, one level deeper — only rendered
  // once a specific month is selected (see the button row below), so this
  // never has to render a whole history's worth of day pills at once.
  const dayGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of monthRows) counts.set(r.date, (counts.get(r.date) ?? 0) + 1)
    return Array.from(counts, ([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day))
  }, [monthRows])

  const scopedRows = React.useMemo(() => {
    if (!selectedDay) return monthRows
    return monthRows.filter((r) => r.date === selectedDay)
  }, [monthRows, selectedDay])

  const uncollectedInDay = React.useMemo(() => scopedRows.filter((r) => !r.collected), [scopedRows])

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
        // Jumps to the record's own standalone page for fields inline
        // editing here doesn't cover (Model, Address, Note, etc.) — not a
        // duplicate of inline editing, which already handles Amount/Payment
        // Type/Unit Price/C-P Price/Delivery Fee/Date/Customer directly in
        // this table. stopPropagation guards against a future onRowClick
        // this table doesn't have today, same defensive convention every
        // other row-action button in this app already follows.
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation()
              onOpenChange(false)
              router.push(`${RECORD_PAGE_PATH_BY_SOURCE[row.original.source]}?id=${row.original.recordId}`)
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [tDispatch, toggleCollected, admins, reassignCollected, editField, onOpenChange, router]
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
            variant={selectedMonth === "all" ? "default" : "outline"}
            className="h-7 gap-1.5"
            onClick={() => {
              setSelectedMonth("all")
              setSelectedDay(undefined)
            }}
          >
            {tCommon("all")}
          </Button>
          {monthGroups.map((g) => (
            <Button
              key={g.month}
              type="button"
              size="sm"
              variant={selectedMonth === g.month ? "default" : "outline"}
              className="h-7 gap-1.5"
              onClick={() => {
                setSelectedMonth(g.month)
                setSelectedDay(undefined)
              }}
            >
              {g.month} <Badge variant="secondary" className="ml-0.5">{g.count}</Badge>
            </Button>
          ))}
        </div>

        {/* Day pills — one level deeper than the month row above, same
            monthGroups/count shape, only rendered once a specific month is
            selected (see dayGroups' own comment) so this never has to show
            a whole history's worth of individual days at once. */}
        {selectedMonth !== "all" && (
          <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-t pt-1.5">
            {dayGroups.map((g) => (
              <Button
                key={g.day}
                type="button"
                size="sm"
                variant={selectedDay === g.day ? "default" : "outline"}
                className="h-7 gap-1.5"
                onClick={() => setSelectedDay((prev) => (prev === g.day ? undefined : g.day))}
              >
                {formatDate(g.day)} <Badge variant="secondary" className="ml-0.5">{g.count}</Badge>
              </Button>
            ))}
            {selectedDay && uncollectedInDay.length > 0 && (
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
        )}

        <div className={cn("flex-1 min-h-0", isFullScreen ? "flex flex-col" : undefined)}>
          <DataTable
            columns={columns}
            data={scopedRows}
            // 50 rows per page, not DataTable's show-everything default: every
            // row here carries ~8 inline-edit controls, so mounting all ~1,000
            // at once put ~35k DOM nodes on the page (multi-second open, laggy
            // typing). "All rows" is still one click away in the footer, and
            // search still filters the full dataset before it's paged.
            pageSize={ALL_COLLECTION_PAGE_SIZE}
            // Saving an inline edit refetches (new `data` identity); without
            // this the table would bounce back to page 1 on every save. The
            // page now only resets when the scope pills below change.
            pageResetKey={`${dateRangeFilter}|${selectedMonth}|${selectedDay ?? ""}`}
            searchPlaceholder={t("searchPlaceholder")}
            emptyMessage={t("noRecordsFound")}
            tableContainerClassName="scrollbar-always-visible"
            tableClassName="min-w-max"
            scrollContainerClassName={isFullScreen ? undefined : "overflow-y-visible"}
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

      <ConfirmDialog
        open={confirmBulkApprove}
        onOpenChange={setConfirmBulkApprove}
        title={t("bulkApproveConfirmTitle")}
        description={t("bulkApproveConfirmDescription", { count: String(uncollectedInDay.length), day: selectedDay ? formatDate(selectedDay) : "" })}
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
    </Dialog>
  )
}
