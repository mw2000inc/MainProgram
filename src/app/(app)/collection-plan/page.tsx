"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Banknote, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { getCollectionsFullColumns, COLLECTIONS_EXPORT_COLUMNS } from "@/components/collections/collections-columns"
import { useCollections, useDeleteCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
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
  const [filteredRows, setFilteredRows] = React.useState<CollectionPlan[]>(entries)

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, entries.some((e) => e.id === initialId))

  const monthGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      const ym = yearMonth(e.collectionDate)
      counts.set(ym, (counts.get(ym) ?? 0) + 1)
    }
    return Array.from(counts, ([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))
  }, [entries])

  const scopedEntries = React.useMemo(() => {
    if (selectedMonth === "all") return entries
    return entries.filter((e) => yearMonth(e.collectionDate) === selectedMonth)
  }, [entries, selectedMonth])

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

  const selected = selection.selected

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
        list={
          <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-4 items-start">
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
                  {monthGroups.map((g) => (
                    <button
                      key={g.month}
                      onClick={() => setSelectedMonth(g.month)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors",
                        selectedMonth === g.month && "bg-accent font-medium"
                      )}
                    >
                      <span>{g.month}</span>
                      <Badge variant="secondary" className="ml-2">
                        {g.count}
                      </Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <DataTable
                  columns={columns}
                  data={scopedEntries}
                  searchPlaceholder={t("searchPlaceholder")}
                  emptyMessage={t("noPlansFound")}
                  onFilteredRowsChange={setFilteredRows}
                  onRowClick={(row) => selection.open(row)}
                />
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
