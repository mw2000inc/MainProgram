"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { RepairPartsSection } from "@/components/repair/repair-parts-section"
import {
  getRepairDateColumns,
  getRepairOrderGroupColumns,
  REPAIR_EXPORT_COLUMNS,
  type RepairOrderGroup,
} from "@/components/repair/repair-columns"
import { useDeleteRepairPlans, useRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
import { formatCurrency, formatDate, todayIso } from "@/lib/utils"
import type { RepairPlan } from "@/lib/types"

function RepairPlanPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("repair")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: plans = [], isPending } = useRepairPlans()
  const deletePlans = useDeleteRepairPlans()
  const updatePlan = useUpdateRepairPlan()

  // Deep link from e.g. the Daily Report's Repair Plan panel (?id=<planId>)
  // — drills all the way in to that specific record's own detail panel, not
  // just its order's date list.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined
  const initialPlan = plans.find((p) => p.id === initialId)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RepairPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<RepairPlan | undefined>(undefined)
  const [filteredGroups, setFilteredGroups] = React.useState<RepairOrderGroup[]>([])
  // Which repair record's parts-history modal (RepairPartsSection's own
  // "Expand" dialog) is open, if any.
  const [partsModalRepairId, setPartsModalRepairId] = React.useState<string | null>(null)

  // One row per distinct order_no — repeat visits for the same order
  // (different dates) collapse into a single row here; drilling into one
  // reveals its own list of dates instead of every field inline. Most
  // recent date first within each group, which is also where latestDate
  // (MAX(issued_date) for that order — its own sortable column, see
  // getRepairOrderGroupColumns) comes from: recomputed fresh from `plans`
  // every time, never a stored value, so a newly added repair immediately
  // becomes the latest without anything else needing to change.
  const orderGroups = React.useMemo<RepairOrderGroup[]>(() => {
    const map = new Map<string, RepairPlan[]>()
    for (const p of plans) {
      const list = map.get(p.orderNo)
      if (list) list.push(p)
      else map.set(p.orderNo, [p])
    }
    return Array.from(map, ([orderNo, records]) => {
      const sorted = [...records].sort((a, b) => b.issuedDate.localeCompare(a.issuedDate))
      return {
        id: orderNo,
        orderNo,
        accountName: sorted[0].accountName,
        latestDate: sorted[0].issuedDate,
        records: sorted,
      }
    })
  }, [plans])

  const orderSelection = useSplitViewSelection(filteredGroups, initialPlan?.orderNo)
  // The specific repair visit (date) shown within the drilled-into order —
  // scoped to that order's own records, not the full plans list, so Prev/
  // Next steps through this order's dates rather than every unrelated
  // repair in the whole table.
  const selection = useSplitViewSelection(orderSelection.selected?.records ?? [], initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  const orderGroupColumns = React.useMemo(() => getRepairOrderGroupColumns(), [])
  const dateColumns = React.useMemo(() => getRepairDateColumns(), [])

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = selection.selected

  // Wired to RepairDateSwitcher's calendar (via RepairPartsSection), for
  // both jumping to one of this order's OTHER existing dates and (via
  // editIssuedDate below) picking a day that isn't one of them yet.
  function selectHistoryDate(id: string) {
    const target = orderSelection.selected?.records.find((p) => p.id === id)
    if (target) selection.open(target)
  }

  function editIssuedDate(newDate: string) {
    if (!selected) return
    updatePlan.mutate({ id: selected.id, input: { issuedDate: newDate } })
  }

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
            <Wrench className="h-6 w-6 text-primary" /> {tNav("repairPlan")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={REPAIR_EXPORT_COLUMNS} rows={plans} fileName="repair-plan" />
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

      {!orderSelection.selected ? (
        // Level 1: one row per order (Order No / Customer Name) — no side
        // panel at this level, clicking a row drills all the way into that
        // order's own date list + detail view below instead.
        <Card className="flex-1 min-h-0">
          <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
            <div className="flex-1 min-h-0 overflow-hidden">
              <DataTable
                columns={orderGroupColumns}
                data={orderGroups}
                searchPlaceholder={t("searchPlaceholder")}
                emptyMessage={t("noPlansFound")}
                onFilteredRowsChange={setFilteredGroups}
                onRowClick={orderSelection.open}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-hidden">
          <BreadcrumbTrail
            items={[
              { label: tNav("repairPlan"), onClick: orderSelection.close },
              { label: `#${orderSelection.selected.orderNo} — ${orderSelection.selected.accountName}` },
            ]}
          />
          {/* Level 2 + 3 combined: a narrow list of this order's own repair
              dates alongside the currently-selected one's full detail —
              same listWidth="narrow" list+detail pair MemberOrderDetail
              already uses for Customer -> Order. */}
          <SplitViewLayout
            isOpen
            expanded={selection.expanded}
            listWidth="narrow"
            fillHeight
            className="flex-1 min-h-0"
            list={
              <Card className="flex-1 min-h-0">
                <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <DataTable
                      columns={dateColumns}
                      data={orderSelection.selected.records}
                      searchPlaceholder={t("searchPlaceholderDates")}
                      emptyMessage={t("noPlansForDate")}
                      onRowClick={(row) => selection.open(row)}
                    />
                  </div>
                </CardContent>
              </Card>
            }
            detail={
              selected ? (
                <DetailPanel
                  title={selected.accountName}
                  icon={Wrench}
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
                  // Closing goes all the way back to the order list rather
                  // than just deselecting the date — there's no dedicated
                  // "clear the date but stay on this order" gesture, since
                  // the empty-state placeholder below already covers that.
                  onClose={orderSelection.close}
                  extra={
                    <RepairPartsSection
                      key={selected.id}
                      repairPlanId={selected.id}
                      canEdit={isAdmin}
                      orderNo={selected.orderNo}
                      defaultDate={selected.issuedDate}
                      historyDates={orderSelection.selected.records.map((p) => ({ id: p.id, date: p.issuedDate }))}
                      onSelectDate={selectHistoryDate}
                      onEditDate={editIssuedDate}
                      expandedOpen={partsModalRepairId === selected.id}
                      onExpandedOpenChange={(open) => setPartsModalRepairId(open ? selected.id : null)}
                    />
                  }
                  fillHeight
                >
                  <DetailField label={tFields("issuedDate")} value={formatDate(selected.issuedDate)} />
                  <DetailField label={tFields("orderNo")} value={selected.orderNo} />
                  <DetailField label={tFields("accountName")} value={selected.accountName} />
                  <DetailField label={tFields("unitInOut")} value={selected.unitInOut} />
                  <DetailField label={tFields("problem")} value={selected.problem} className="sm:col-span-2" />
                  <DetailField label={tFields("solutionStatus")} value={selected.solutionStatus} className="sm:col-span-2" />
                  <DetailField label={tFields("preD")} value={selected.preD ? formatDate(selected.preD) : undefined} />
                  <DetailField label={tFields("accD")} value={selected.accD ? formatDate(selected.accD) : undefined} />
                  <DetailField label={tFields("th")} value={selected.th} />
                  <DetailField label={tFields("amt")} value={formatCurrency(selected.amt)} />
                  <DetailField label={tFields("status")} value={planStatusLabel(selected.status, tStatus)} />
                </DetailPanel>
              ) : (
                // Nothing picked yet — opening an order no longer
                // auto-selects a date (even a single-date order still
                // requires an explicit click), so this is the normal
                // starting state, not an error/empty-data condition.
                <Card className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                  <Wrench className="h-8 w-8 text-muted-foreground/40" />
                  <p>{t("selectDatePrompt")}</p>
                </Card>
              )
            }
          />
        </div>
      )}

      <RepairFormDialog
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
          if (wasSelected) {
            const remaining = (orderSelection.selected?.records ?? []).filter((p) => p.id !== deleting.id)
            if (remaining.length > 0) selection.open(remaining[0])
            else orderSelection.close()
          }
        }}
      />
    </div>
  )
}

function RepairPlanPageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function RepairPlanPage() {
  return (
    <React.Suspense fallback={<RepairPlanPageFallback />}>
      <RepairPlanPageContent />
    </React.Suspense>
  )
}
