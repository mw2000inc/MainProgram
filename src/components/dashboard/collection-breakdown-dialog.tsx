"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DataTable } from "@/components/data-table/data-table"
import { ColumnHeader } from "@/components/shared/column-header"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineCurrencyCell, InlineDateCell, InlineSelectCell, InlineTextCell } from "@/components/shared/inline-edit-cell"
import { useCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { COLLECTION_PAYMENT_TYPES, DEPOSITED_FUND_OPTIONS } from "@/lib/constants"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { CollectionPlan } from "@/lib/types"
import { matchesActiveDateScope, type DateScope, type DateRangeFilter } from "@/components/dashboard/all-collection-dialog"

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
  // isPending: in practice this dialog is only ever opened from a button
  // inside AllCollectionDialog, which reads this exact same query (same
  // queryKey, shared cache) to render the rows the admin is ALREADY looking
  // at — so by the time the button is even clickable, this has almost
  // always already resolved. Still handled explicitly (a real skeleton, not
  // a silent empty-table flash) for the rare case it hasn't — e.g. a very
  // slow initial load, or this dialog someday gaining a call site that
  // doesn't already depend on the same data.
  const { data: collections = [], isPending } = useCollections()
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
      <DialogContent className="sm:max-w-6xl max-h-[85vh] overflow-y-auto">
        {/* No onInteractOutside guard needed here: AllCollectionDialog's own
            guard already protects IT from a click landing inside this
            dialog (the nested-Dialog gotcha it documents), and this dialog
            has no further nested dialog of its own to protect against —
            only inline Select/Popover cells (Mode of Payment, Deposited
            Fund, Deposited Date), which the exact same components already
            work correctly inside AllCollectionDialog's own main table
            without any such guard. */}
        <DialogHeader>
          <DialogTitle>{t("breakdownTitle")}</DialogTitle>
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
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
