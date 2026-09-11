"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Droplets, Plus, Sparkles } from "lucide-react"
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
import {
  useBulkSuggestTechnicians,
  useDeleteFilterChangePlans,
  useFilterChangePlans,
  useUpdateFilterChangePlan,
} from "@/lib/hooks/use-filter-change-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
import { extractCityLabel } from "@/lib/geo/city-label"
import { cn, formatDate, todayIso } from "@/lib/utils"
import { suggestTechnician as fetchSuggestedTechnician, type TechnicianSuggestion } from "@/lib/api/filter-change-plans"
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
  const { t: tStatus } = useTranslation("status")
  const { data: plans = [], isPending } = useFilterChangePlans()
  const deletePlans = useDeleteFilterChangePlans()
  const updatePlan = useUpdateFilterChangePlan()
  const bulkSuggest = useBulkSuggestTechnicians()

  // Deep link from e.g. the Daily Report's Filter Change Plan panel
  // (?id=<planId>) — opens that record's detail panel directly.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<FilterChangePlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<FilterChangePlan | undefined>(undefined)
  const [bulkConfirmOpen, setBulkConfirmOpen] = React.useState(false)
  const [filteredRows, setFilteredRows] = React.useState<FilterChangePlan[]>(plans)
  // Cached per plan id so re-selecting the same plan doesn't re-fire the
  // suggestion API — this is a read-only comparison shown in the detail
  // panel ("would clustering suggest someone else?"), never applied
  // automatically.
  const [suggestionCache, setSuggestionCache] = React.useState<Record<string, TechnicianSuggestion | null>>({})

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  // Fetches a comparison suggestion for whichever plan is open in the detail
  // panel, only when it already has a technician assigned (an empty
  // serviceman already has its own "Suggest" button in the edit dialog) and
  // is linked to a real customer (unresolvable otherwise). isAdmin-gated:
  // this is a planning aid for whoever assigns technicians, not something a
  // read-only viewer needs to trigger a network call for.
  React.useEffect(() => {
    const plan = selection.selected
    if (!isAdmin || !plan || !plan.serviceman.trim() || !plan.customerId) return
    if (plan.id in suggestionCache) return
    let cancelled = false
    // Calls the API function directly rather than the useSuggestTechnician
    // mutation hook — that hook toasts on every failure, which is right for
    // an admin who deliberately clicked "Suggest," but wrong here: this
    // fires passively just from opening a record, and an unresolvable
    // address shouldn't surface as an error the admin didn't ask for.
    fetchSuggestedTechnician(plan.id).then(
      (result) => {
        if (!cancelled) setSuggestionCache((prev) => ({ ...prev, [plan.id]: result }))
      },
      () => {
        if (!cancelled) setSuggestionCache((prev) => ({ ...prev, [plan.id]: null }))
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.selected?.id, isAdmin])

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

  const unassignedInView = React.useMemo(() => scopedPlans.filter((p) => !p.serviceman.trim()), [scopedPlans])

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
          {isAdmin && (
            <Button variant="outline" className="gap-1.5" onClick={() => setBulkConfirmOpen(true)}>
              <Sparkles className="h-4 w-4" /> {t("autoSuggestTechnicians")}
            </Button>
          )}
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
              <DetailField
                label={tFields("address")}
                value={
                  <>
                    {selected.address || "—"}
                    {extractCityLabel(selected.address) && (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {t("recognizedArea", { area: extractCityLabel(selected.address)! })}
                      </p>
                    )}
                  </>
                }
                className="sm:col-span-2"
              />
              <DetailField label={tFields("sc")} value={selected.sc} />
              <DetailField label={tFields("productNo")} value={selected.productNo} />
              <DetailField label={tFields("planD")} value={formatDate(selected.planDate)} />
              <DetailField label={tFields("preD")} value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label={tFields("accD")} value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField
                label={tFields("serviceman")}
                value={
                  <>
                    {selected.serviceman || "—"}
                    {(() => {
                      const cached = suggestionCache[selected.id]
                      if (!cached) return null
                      if (cached.outsideCoverage) {
                        return (
                          <Badge variant="outline" className="ml-2 text-amber-600 border-amber-600/40 align-middle">
                            {t("outsideUsualCoverage")}
                          </Badge>
                        )
                      }
                      if (cached.technician !== selected.serviceman) {
                        return (
                          <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                            {t("suggestedInstead", { technician: cached.technician })} {cached.explanation}
                          </p>
                        )
                      }
                      return null
                    })()}
                  </>
                }
              />
              <DetailField label={tFields("status")} value={planStatusLabel(selected.status, tStatus)} />
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

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        title={t("autoSuggestConfirmTitle", { count: String(unassignedInView.length) })}
        description={unassignedInView.length > 0 ? t("autoSuggestConfirmDescription") : t("noUnassignedPlans")}
        confirmLabel={t("autoSuggestTechnicians")}
        destructive={false}
        loading={bulkSuggest.isPending}
        onConfirm={async () => {
          if (unassignedInView.length === 0) {
            setBulkConfirmOpen(false)
            return
          }
          await bulkSuggest.mutateAsync(unassignedInView.map((p) => p.id))
          setSuggestionCache({})
          setBulkConfirmOpen(false)
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
