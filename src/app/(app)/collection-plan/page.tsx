"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Banknote, ChevronDown, ChevronRight, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useLatestRow, useSplitViewSelection } from "@/components/data-table/split-view"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { getCollectionsFullColumns, COLLECTIONS_EXPORT_COLUMNS, type CollectionRow } from "@/components/collections/collections-columns"
import { useCollections, useDeleteCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { cn, formatCurrency, formatDate, todayIso } from "@/lib/utils"
import type { CollectionPlan } from "@/lib/types"

function yearMonth(dateStr: string) {
  return dateStr.slice(0, 7)
}

function CollectionPlanPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("collection")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: entries = [], isPending } = useCollections()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const deleteEntries = useDeleteCollections()
  const updateEntry = useUpdateCollection()

  // Deep link from e.g. the Daily Report's Collection Plan panel
  // (?id=<entryId>) — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CollectionPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<CollectionPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<CollectionRow[]>([])

  // Folds in the linked customer's own "SK001-####" order_number (see
  // customer-lookup.ts's resolveCustomerForPlan) — this entry's own orderNo
  // ("001-####") is already searchable directly, this was the missing
  // direction, same gap the Sep 11 Member List fix closed there.
  // S/C and Product come from the collection's order: its linked Sale List
  // entry, else the first entry with the same order number.
  const saleEntryLookup = React.useMemo(() => {
    const byId = new Map(saleListEntries.map((s) => [s.id, s]))
    const byOrder = new Map<string, (typeof saleListEntries)[number]>()
    for (const s of saleListEntries) {
      const key = s.orderNumber.trim()
      if (key && !byOrder.has(key)) byOrder.set(key, s)
    }
    return { byId, byOrder }
  }, [saleListEntries])
  const rows: CollectionRow[] = React.useMemo(
    () =>
      entries.map((e) => {
        const customer = resolveCustomerForPlan(customers, saleListEntries, e.customerId, e.orderNo)
        const order = (e.saleListEntryId ? saleEntryLookup.byId.get(e.saleListEntryId) : undefined) ?? saleEntryLookup.byOrder.get(e.orderNo.trim())
        return {
          ...e,
          customerOrderNumber: customer?.orderNumber ?? "",
          resolvedCustomerId: customer?.id,
          sc: order?.sc?.trim() || undefined,
          product: order?.productNo?.trim() || undefined,
        }
      }),
    [entries, customers, saleListEntries, saleEntryLookup]
  )

  const selection = useSplitViewSelection(filteredRows, initialId)
  // Current copy of the selected row, not the one filteredRows may still
  // hold from before a save (see useLatestRow).
  const latestSelected = useLatestRow(selection.selected, rows)
  useDeepLinkNotFoundToast(initialId, isPending, entries.some((e) => e.id === initialId))

  // Sidebar: years, each expanding to its months (same as Filter Change).
  // Each badge reads "pending/total": collections still Pending (Collected
  // and Cancelled ones aren't) out of all collections in that period. The
  // table still lists every collection of the selected month.
  const yearGroups = React.useMemo(() => {
    const byMonth = new Map<string, { pending: number; total: number }>()
    for (const e of rows) {
      const ym = yearMonth(e.collectionDate)
      const c = byMonth.get(ym) ?? { pending: 0, total: 0 }
      c.total += 1
      if (e.status === "Pending") c.pending += 1
      byMonth.set(ym, c)
    }
    const byYear = new Map<string, { month: string; pending: number; total: number }[]>()
    for (const [month, c] of Array.from(byMonth).sort((a, b) => a[0].localeCompare(b[0]))) {
      const year = month.slice(0, 4)
      const list = byYear.get(year)
      if (list) list.push({ month, ...c })
      else byYear.set(year, [{ month, ...c }])
    }
    return Array.from(byYear, ([year, months]) => ({
      year,
      months,
      pending: months.reduce((sum, m) => sum + m.pending, 0),
      total: months.reduce((sum, m) => sum + m.total, 0),
    }))
  }, [rows])
  const [expandedYears, setExpandedYears] = React.useState<Set<string>>(() => new Set([todayIso().slice(0, 4)]))
  const toggleYear = (year: string) =>
    setExpandedYears((prev) => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  // Selecting a month (or a save that jumps to one) keeps its year open.
  const selectMonth = (month: string) => {
    setSelectedMonth(month)
    if (month !== "all") setExpandedYears((prev) => (prev.has(month.slice(0, 4)) ? prev : new Set(prev).add(month.slice(0, 4))))
  }

  const scopedEntries = React.useMemo(() => {
    if (selectedMonth === "all") return rows
    return rows.filter((e) => yearMonth(e.collectionDate) === selectedMonth)
  }, [rows, selectedMonth])

  const columns = React.useMemo(
    () =>
      getCollectionsFullColumns({
        canDelete: isAdmin,
        canEditDate: isAdmin,
        onDelete: (e) => setDeleting(e),
        onEditDate: (e) => {
          setEditing(e)
          setFormOpen(true)
        },
        onStatusChange: isAdmin ? (e, status) => updateEntry.mutate({ id: e.id, input: { status } }) : undefined,
      }),
    [isAdmin, updateEntry]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = latestSelected

  return (
    // h-full so this page's own share of <main> (already the app's one real
    // scroll region — see layout.tsx) is a real, definite height rather
    // than "however tall my content happens to be" — everything below that
    // isn't the table area is shrink-0, so the table's flex-1 share is
    // exactly "whatever's left," and its own internal scroll (see
    // data-table.tsx's h-full) is the only thing that ever needs to move.
    <div className="flex h-full flex-col gap-6 overflow-hidden">
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Banknote className="h-6 w-6 text-primary" /> {tNav("collectionPlan")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={COLLECTIONS_EXPORT_COLUMNS} rows={scopedEntries} fileName="collection-plan" />
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> {tCommon("add")}
          </Button>
        </div>
      </div>

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        breakpoint="xl"
        fillHeight
        className="flex-1 min-h-0"
        // grid-rows-[minmax(0,1fr)] below is required alongside
        // items-stretch — with no explicit row track a grid row defaults to
        // grid-template-rows: auto (sized to content), so items-stretch
        // alone only matches these two columns to each other's natural
        // height, not to whatever flex-1/min-h-0 gives this grid from its
        // own parent. See split-view.tsx's own fillHeight comment for the
        // full explanation — same bug, same fix, hand-rolled here since
        // this specific 2-column layout isn't SplitViewLayout itself.
        list={
          <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[200px_1fr] grid-rows-[minmax(0,1fr)] gap-4 items-stretch">
            <Card>
              <CardContent className="p-0">
                <div className="max-h-[70vh] overflow-y-auto divide-y">
                  <button
                    onClick={() => setSelectedMonth("all")}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors",
                      selectedMonth === "all" && "bg-accent font-medium"
                    )}
                  >
                    {tCommon("all")}
                  </button>
                  {yearGroups.map((y) => {
                    const open = expandedYears.has(y.year)
                    return (
                      <div key={y.year} data-testid="cp-year">
                        <button
                          onClick={() => toggleYear(y.year)}
                          aria-expanded={open}
                          className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-muted/50 transition-colors"
                          data-testid="cp-year-toggle"
                        >
                          <span className="flex items-center gap-1">
                            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {y.year}
                          </span>
                          <Badge variant={y.pending ? "secondary" : "outline"} className="ml-2 tabular-nums" data-testid="cp-year-count">
                            {y.pending}/{y.total}
                          </Badge>
                        </button>
                        {open &&
                          y.months.map((g) => (
                            <button
                              key={g.month}
                              onClick={() => selectMonth(g.month)}
                              className={cn(
                                "flex w-full items-center justify-between py-2 pl-7 pr-3 text-sm hover:bg-muted/50 transition-colors",
                                selectedMonth === g.month && "bg-accent font-medium"
                              )}
                              data-testid="cp-month"
                              data-month={g.month}
                            >
                              <span>{g.month}</span>
                              <Badge variant={g.pending ? "secondary" : "outline"} className="ml-2 tabular-nums" data-testid="cp-month-count">
                                {g.pending}/{g.total}
                              </Badge>
                            </button>
                          ))}
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="flex-1 min-h-0">
              <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
                {/* flex-1 min-h-0 overflow-hidden is what hands DataTable's
                    own h-full scroll box its exact bounded height instead
                    of letting it grow to content. */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <DataTable
                    columns={columns}
                    data={scopedEntries}
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("noPlansFound")}
                    onFilteredRowsChange={setFilteredRows}
                    onRowClick={(row) => selection.open(row)}
                    // 1,000+ entries on one page: render only the rows in view.
                    virtualize
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        }
        detail={
          selected && (
            <DetailPanel
              title={selected.accountName}
              icon={Banknote}
              subtitle={selected.orderNo}
              onEdit={
                isAdmin
                  ? () => {
                      setEditing(selected)
                      setFormOpen(true)
                    }
                  : undefined
              }
              onDelete={isAdmin ? () => setDeleting(selected) : undefined}
              onPrev={selection.prev}
              onNext={selection.next}
              hasPrev={selection.hasPrev}
              hasNext={selection.hasNext}
              expanded={selection.expanded}
              onToggleExpand={() => selection.setExpanded((v) => !v)}
              onClose={selection.close}
            >
              <DetailField label={tFields("orderNumber")} value={selected.orderNo} />
              <DetailField label={tFields("memberAccount")} value={selected.accountName} />
              <DetailField label={tFields("amount")} value={formatCurrency(selected.amount)} />
              <DetailField label={tFields("ct")} value={selected.ct} />
              <DetailField
                label={tFields("planD")}
                value={
                  isAdmin ? (
                    <button
                      type="button"
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setEditing(selected)
                        setFormOpen(true)
                      }}
                    >
                      {formatDate(selected.collectionDate)}
                    </button>
                  ) : (
                    formatDate(selected.collectionDate)
                  )
                }
              />
              <DetailField label={tFields("preD")} value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label={tFields("accD")} value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField label={tFields("status")} value={planStatusLabel(selected.status, tStatus)} />
              <DetailField
                label={tFields("filterChange")}
                value={selected.filterChangeRequired ? tFields("required") : undefined}
              />
              <DetailField
                label={tFields("source")}
                value={
                  selected.source === "recurring_schedule"
                    ? tFields("recurringSchedule")
                    : selected.source === "ct_completion"
                      ? t("autoCTCompletion")
                      : tFields("manual")
                }
              />
              <DetailField label={tFields("note")} value={selected.note} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <CollectionsFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={todayIso()}
        entry={editing}
        // See filter-change/page.tsx's own identical prop for why: this
        // page's table is also scoped to one month tab, so a saved record
        // dated outside it would otherwise look like the save silently
        // failed. Only switches tabs when the saved record actually isn't
        // visible in the current one.
        onSaved={(saved) => {
          const savedMonth = yearMonth(saved.collectionDate)
          if (selectedMonth !== "all" && selectedMonth !== savedMonth) selectMonth(savedMonth)
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deleteEntries.mutateAsync([deleting.id])
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />
    </div>
  )
}

function CollectionPlanPageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function CollectionPlanPage() {
  return (
    <React.Suspense fallback={<CollectionPlanPageFallback />}>
      <CollectionPlanPageContent />
    </React.Suspense>
  )
}
