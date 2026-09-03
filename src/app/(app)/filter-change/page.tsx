"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Droplets, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getFilterChangeFullColumns, FILTER_CHANGE_EXPORT_COLUMNS } from "@/components/filter-change/filter-change-columns"
import { useDeleteFilterChangePlans, useFilterChangePlans, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate, todayIso } from "@/lib/utils"
import type { FilterChangePlan } from "@/lib/types"

function yearMonth(dateStr: string) {
  return dateStr.slice(0, 7)
}

function FilterChangePageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("filterChange")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: plans = [], isPending } = useFilterChangePlans()
  const deletePlans = useDeleteFilterChangePlans()
  const updatePlan = useUpdateFilterChangePlan()

  // Deep link from e.g. the Daily Report's Filter Change Plan panel
  // (?id=<planId>) — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<FilterChangePlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<FilterChangePlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<FilterChangePlan[]>(plans)

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const monthGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of plans) {
      const ym = yearMonth(p.planDate)
      counts.set(ym, (counts.get(ym) ?? 0) + 1)
    }
    return Array.from(counts, ([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month))
  }, [plans])

  const scopedPlans = React.useMemo(() => {
    if (selectedMonth === "all") return plans
    return plans.filter((p) => yearMonth(p.planDate) === selectedMonth)
  }, [plans, selectedMonth])

  const columns = React.useMemo(
    () =>
      getFilterChangeFullColumns({
        canDelete: isAdmin,
        onDelete: (p) => setDeleting(p),
        onStatusChange: isAdmin ? (p, status) => updatePlan.mutate({ id: p.id, input: { status } }) : undefined,
      }),
    [isAdmin, updatePlan]
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
            <Droplets className="h-6 w-6 text-primary" /> {tNav("filterChange")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={FILTER_CHANGE_EXPORT_COLUMNS} rows={scopedPlans} fileName="filter-change" />
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
                  data={scopedPlans}
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
              title={selected.memberAccount}
              icon={Droplets}
              subtitle={selected.orderNumber}
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
              <DetailField label={tFields("orderNumber")} value={selected.orderNumber} />
              <DetailField label={tFields("memberAccount")} value={selected.memberAccount} />
              <DetailField label={tFields("filter")} value={selected.filterType} />
              <DetailField label={tFields("contactNumber")} value={selected.contactNumber} />
              <DetailField label={tFields("address")} value={selected.address} className="sm:col-span-2" />
              <DetailField label={tFields("sc")} value={selected.sc} />
              <DetailField label={tFields("productNo")} value={selected.productNo} />
              <DetailField label={tFields("planD")} value={formatDate(selected.planDate)} />
              <DetailField label={tFields("preD")} value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label={tFields("accD")} value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField label={tFields("serviceman")} value={selected.serviceman} />
              <DetailField label={tFields("status")} value={selected.status} />
              <DetailField label={tFields("note")} value={selected.note} className="sm:col-span-2" />
            </DetailPanel>
          )
        }
      />

      <FilterChangeFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        defaultDate={todayIso()}
        plan={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        loading={deletePlans.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deletePlans.mutateAsync([deleting.id])
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />
    </div>
  )
}

function FilterChangePageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function FilterChangePage() {
  return (
    <React.Suspense fallback={<FilterChangePageFallback />}>
      <FilterChangePageContent />
    </React.Suspense>
  )
}
