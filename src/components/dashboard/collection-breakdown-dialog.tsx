"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Download, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table/data-table"
import { ColumnHeader } from "@/components/shared/column-header"
import { Skeleton } from "@/components/ui/skeleton"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { InlineCurrencyCell, InlineDateCell, InlineSelectCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { useCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { COLLECTION_PAYMENT_TYPES, DEPOSITED_FUND_OPTIONS } from "@/lib/constants"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { exportToCsv } from "@/lib/export/csv"
import { cn, formatDate, todayIso } from "@/lib/utils"
import type { CollectionPlan } from "@/lib/types"
import {
  matchesActiveDateScope,
  DATE_RANGE_MONTH_NAMES,
  type DateScope,
  type DateRangeFilter,
} from "@/components/dashboard/all-collection-dialog"

// Names the exported file after whatever the active date scope actually is,
// so an admin who exports twice under two different filters doesn't end up
// with two files both just called "Collection_Breakdown.csv" — a custom
// range gets its own [from, to] span in the name, a monthOnly scope gets its
// month name, matching the same DATE_RANGE_MONTH_NAMES the scope's own
// dropdown already shows.
function buildExportFileName(params: {
  dateScope: DateScope
  customFrom: string | undefined
  customTo: string | undefined
  monthOnlyIndex: number | undefined
}): string {
  if (params.dateScope === "custom" && params.customFrom && params.customTo) {
    return `Collection_Breakdown_${params.customFrom}_to_${params.customTo}`
  }
  if (params.dateScope === "monthOnly" && params.monthOnlyIndex != null) {
    return `Collection_Breakdown_${DATE_RANGE_MONTH_NAMES[params.monthOnlyIndex]}_All_Years`
  }
  if (params.dateScope === "today") {
    return `Collection_Breakdown_Today_${todayIso()}`
  }
  return "Collection_Breakdown_All"
}

// Same reasoning all-collection-dialog.tsx's own ALL_COLLECTION_PAGE_SIZE
// gives: every row here carries several inline-edit controls (two Selects,
// a date popover, currency/text inputs), so rendering an unbounded result
// set at once (DataTable's own default with no pageSize is "show every
// row") both makes the dialog's own open animation janky (React has to
// build every row's worth of elements synchronously before first paint)
// and scales badly as this table grows. "All rows" is still one click away
// in the footer, and search still filters the full scoped set before it's
// paged.
const COLLECTION_BREAKDOWN_PAGE_SIZE = 50

// The "Collection Details" trigger badge (All Collection's own toolbar, next
// to the Collected/Not Collected summary badges) opens this — a dedicated
// cash/cheque reconciliation table matching an existing external
// spreadsheet, over collections records specifically (see the
// collection_breakdown_fields migration's own comment for why this is
// Collections-only, not Install/Repair too: no equivalent "how was this
// received, where did it end up" workflow exists on either of those, and
// their own amount is split across three sub-fields with no single number
// to show in this dialog's one "Amount" column).
//
// Takes the SAME primitive date-scope fields AllCollectionDialog holds
// (rather than one packaged object) so this component's own useMemo below
// can depend on them directly — a freshly-constructed object prop would
// have a new identity every parent render regardless of whether the actual
// scope changed, defeating that memoization. Filtered via the exact same
// matchesActiveDateScope function AllCollectionDialog's own scopedRows
// already uses, so the two views can never silently disagree about what
// "the current date scope" means.
export function CollectionBreakdownDialog({
  open,
  onOpenChange,
  dateRangeFilter,
  dateScope,
  customFrom,
  customTo,
  monthOnlyIndex,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dateRangeFilter: DateRangeFilter
  dateScope: DateScope
  customFrom: string | undefined
  customTo: string | undefined
  monthOnlyIndex: number | undefined
}) {
  const { t } = useTranslation("allCollection")
  const { t: tFields } = useTranslation("fields")
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  // This component never unmounts when the dialog closes (AllCollectionDialog
  // always renders it, passing `open` straight through to Radix's own
  // Dialog — see scopedCollections' own comment below on this same fact) —
  // without this, full-screen would still be engaged the next time the
  // admin opens this dialog, same reset-on-close AllCollectionDialog's own
  // full-screen toggle already does.
  React.useEffect(() => {
    if (!open) exitFullScreen()
  }, [open, exitFullScreen])
  // isPending: in practice this dialog is only ever opened from a button
  // inside AllCollectionDialog, which reads this exact same query (same
  // queryKey, shared cache) to render the rows the admin is ALREADY looking
  // at — so by the time the button is even clickable, this has almost
  // always already resolved. Still handled explicitly (a real skeleton, not
  // a silent empty-table flash) for the rare case it hasn't — e.g. a very
  // slow initial load, or this dialog someday gaining a call site that
  // doesn't already depend on the same data.
  const { data: collections = [], isPending } = useCollections()
  const [addOpen, setAddOpen] = React.useState(false)
  // Only mutateAsync taken (not the whole mutation object) for the same
  // stable-identity reason all-collection-dialog.tsx's own
  // useCollectionRecordUpdaters already documents: useMutation returns a
  // fresh object every render, but mutateAsync itself stays stable, and
  // `columns` below is memoized on it — a new function identity every
  // render would rebuild (and remount) every cell in the table.
  const { mutateAsync: updateCollection } = useUpdateCollection()

  const editField = React.useCallback(
    (id: string, input: Partial<Omit<CollectionPlan, "id" | "createdAt">>) => updateCollection({ id, input }),
    [updateCollection]
  )

  // Deliberately does NOT list `open` as a dependency — this component
  // never unmounts when the dialog closes (AllCollectionDialog always
  // renders it, passing `open` straight through to Radix's own Dialog), so
  // toggling open/closed alone never invalidates this memo; it only
  // recomputes when the underlying data or the active date scope actually
  // changes.
  const scopedCollections = React.useMemo(
    () => collections.filter((c) => matchesActiveDateScope(c.collectionDate, { dateRangeFilter, dateScope, customFrom, customTo, monthOnlyIndex })),
    [collections, dateRangeFilter, dateScope, customFrom, customTo, monthOnlyIndex]
  )

  // Exports scopedCollections (the full active-date-scope set) rather than
  // whatever the table's own search box or current page happen to be
  // showing — "all rows matching the active date scope" is what was asked
  // for, not "whatever's currently visible on screen."
  function handleExportCsv() {
    const records = scopedCollections.map((c) => ({
      [t("orderNumberColumn")]: c.orderNo,
      [t("nameColumn")]: c.accountName,
      [t("descriptionColumn")]: c.description ?? "",
      [t("modeOfPaymentColumn")]: c.paymentType ?? "",
      [tFields("amount")]: c.amount,
      [t("chequeDetailsColumn")]: c.chequeDetails ?? "",
      [t("collectionDateColumn")]: c.collectionDate,
      [t("depositedDateColumn")]: c.depositedDate ?? "",
      [t("depositedFundColumn")]: c.depositedFund ?? "",
      [tFields("note")]: c.note ?? "",
    }))
    exportToCsv(records, buildExportFileName({ dateScope, customFrom, customTo, monthOnlyIndex }))
  }

  const columns: ColumnDef<CollectionPlan, unknown>[] = React.useMemo(
    () => [
      {
        accessorKey: "orderNo",
        header: () => <ColumnHeader tKey="orderNumberColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineTextCell
            value={row.original.orderNo}
            onCommit={(next) => editField(row.original.id, { orderNo: next })}
            className="w-full min-w-[110px]"
          />
        ),
      },
      {
        accessorKey: "accountName",
        header: () => <ColumnHeader tKey="nameColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineTextCell
            value={row.original.accountName}
            onCommit={(next) => editField(row.original.id, { accountName: next })}
            className="w-full min-w-[140px]"
          />
        ),
      },
      {
        accessorKey: "description",
        header: () => <ColumnHeader tKey="descriptionColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineTextCell
            value={row.original.description ?? ""}
            onCommit={(next) => editField(row.original.id, { description: next })}
            className="w-full min-w-[160px]"
          />
        ),
      },
      {
        accessorKey: "paymentType",
        header: () => <ColumnHeader tKey="modeOfPaymentColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineSelectCell
            value={row.original.paymentType}
            options={COLLECTION_PAYMENT_TYPES}
            placeholder="—"
            onCommit={(next) => editField(row.original.id, { paymentType: next })}
          />
        ),
      },
      {
        accessorKey: "amount",
        header: () => <ColumnHeader tKey="amount" ns="fields" />,
        cell: ({ row }) => (
          <InlineCurrencyCell value={row.original.amount} onCommit={(next) => editField(row.original.id, { amount: next })} />
        ),
      },
      {
        accessorKey: "chequeDetails",
        header: () => <ColumnHeader tKey="chequeDetailsColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineTextCell
            value={row.original.chequeDetails ?? ""}
            onCommit={(next) => editField(row.original.id, { chequeDetails: next })}
            className="w-full min-w-[140px]"
          />
        ),
      },
      // Read-only on purpose: this is the record's own date (the same field
      // the active date scope filters on), shown so it can be compared
      // against Deposited Date — not a fallback value inside that picker,
      // which would make an undeposited payment look deposited.
      {
        accessorKey: "collectionDate",
        header: () => <ColumnHeader tKey="collectionDateColumn" ns="allCollection" />,
        cell: ({ row }) => <span className="inline-block min-w-25 text-xs">{formatDate(row.original.collectionDate)}</span>,
      },
      {
        accessorKey: "depositedDate",
        header: () => <ColumnHeader tKey="depositedDateColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineDateCell value={row.original.depositedDate} onCommit={(next) => editField(row.original.id, { depositedDate: next })} />
        ),
      },
      {
        accessorKey: "depositedFund",
        header: () => <ColumnHeader tKey="depositedFundColumn" ns="allCollection" />,
        cell: ({ row }) => (
          <InlineSelectCell
            value={row.original.depositedFund}
            options={DEPOSITED_FUND_OPTIONS}
            placeholder="—"
            onCommit={(next) => editField(row.original.id, { depositedFund: next })}
          />
        ),
      },
      {
        accessorKey: "note",
        header: () => <ColumnHeader tKey="note" ns="fields" />,
        cell: ({ row }) => (
          <InlineTextCell
            value={row.original.note ?? ""}
            onCommit={(next) => editField(row.original.id, { note: next })}
            className="w-full min-w-[160px]"
          />
        ),
      },
    ],
    [editField]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Same full-screen className shape AllCollectionDialog's own
          // toggle already uses — this dialog is already its own real Radix
          // Dialog (not a plain div needing a manual document.body portal
          // the way pending-approvals-panel.tsx's full-screen view does),
          // so Radix's own DismissableLayer already re-enables pointer
          // events on this exact Content node regardless of size or
          // nesting inside AllCollectionDialog — confirmed by every inline
          // edit in this table already working correctly today at the
          // normal size. Only the sizing needs to change.
          isFullScreen
            ? "inset-0 top-0 left-0 h-screen max-h-screen w-screen max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-6"
            : "sm:max-w-6xl max-h-[85vh]",
          "overflow-y-auto"
        )}
        // A backdrop click (or a stray click that lands outside this
        // content for any other reason) must never close this dialog —
        // only the X button or Escape may. Both handlers set for the same
        // reason CollectionsFormDialog/InstallFormDialog/RepairFormDialog
        // already do this: onPointerDownOutside alone only covers pointer
        // events, onInteractOutside also covers a focus-outside dismissal,
        // and Radix fires whichever is relevant to how the outside
        // interaction happened.
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span>{t("breakdownTitle")}</span>
            <FullScreenToggleButton isFullScreen={isFullScreen} onToggle={toggleFullScreen} />
          </DialogTitle>
          <DialogDescription>{t("breakdownDescription")}</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full max-w-xs" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={scopedCollections}
            pageSize={COLLECTION_BREAKDOWN_PAGE_SIZE}
            // Resets to page 1 only when the actual date scope changes, not
            // on every inline-edit-triggered refetch (a fresh `collections`
            // array reference from invalidateQueries otherwise bounces the
            // admin back to page 1 mid-edit) — same pageResetKey pattern
            // AllCollectionDialog's own table already uses, for the exact
            // same reason.
            pageResetKey={`${dateRangeFilter}|${dateScope}|${customFrom ?? ""}|${customTo ?? ""}|${monthOnlyIndex ?? ""}`}
            searchPlaceholder={t("breakdownSearchPlaceholder")}
            emptyMessage={t("breakdownNoRecords")}
            tableContainerClassName="scrollbar-always-visible"
            tableClassName="min-w-max"
            // Exports scopedCollections (see handleExportCsv's own comment),
            // not the table's own further-narrowed search/page state — the
            // toolbar sits directly beside DataTable's own search input,
            // same placement the Collected/Not Collected badges use on
            // AllCollectionDialog's own table.
            toolbar={
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  {t("addCollectionButton")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleExportCsv}>
                  <Download className="w-4 h-4 mr-2" />
                  {t("exportCsvButton")}
                </Button>
              </>
            }
          />
        )}
      </DialogContent>

      {/* Reuses the same Add/Edit dialog the standalone /collection-plan
          page's own "Add" button opens — this app has no customer
          search-and-select picker anywhere; every other Add flow (Filter
          Change, Install, Repair) already works by typing an order number,
          which autofills the matching existing customer's account name on
          blur (handleOrderNoBlur) if one is found, or stays free-text for a
          brand-new one. Reusing it here keeps this one consistent with
          every other "add a record" affordance in the app instead of
          introducing a second, different pattern just for this dialog. */}
      <CollectionsFormDialog open={addOpen} onOpenChange={setAddOpen} defaultDate={todayIso()} />
    </Dialog>
  )
}
