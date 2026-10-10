"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { RepairPartsSection } from "@/components/repair/repair-parts-section"
import { getRepairListColumns, matchesRepairSearch, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteRepairPlans, useRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useAllRepairPlanParts } from "@/lib/hooks/use-repair-plan-parts"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { planStatusLabel } from "@/components/shared/status-badge"
import { formatCurrency, formatDate, todayIso } from "@/lib/utils"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import type { RepairPlan } from "@/lib/types"

// Same as the Filter Change page: 50 rows keep the DOM small by default,
// with "All" still available from the rows-per-page control.
const REPAIR_PAGE_SIZE = 50

// The repairs of the same account as `plan` — its order number when it has
// one, else its account name — for the detail's date switcher.
function sameAccountKey(plan: RepairPlan): string {
  return plan.orderNo.trim() ? `order:${plan.orderNo.trim()}` : `name:${plan.accountName.trim().toLowerCase()}`
}

function RepairPlanPageContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t } = useTranslation("repair")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const { data: plans = [], isPending } = useRepairPlans()
  const { data: allParts = [] } = useAllRepairPlanParts()
  const deletePlans = useDeleteRepairPlans()
  const updatePlan = useUpdateRepairPlan()

  // Deep link (?id=<planId>) from the Daily Report's Repair panel, the
  // Schedule, notifications, Admin Activity and service history: opens that
  // repair's detail.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<RepairPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<RepairPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<RepairPlan[]>([])
  // Which repair's parts-history modal (RepairPartsSection's "Expand") is open.
  const [partsModalRepairId, setPartsModalRepairId] = React.useState<string | null>(null)

  // One row per repair, newest Issued Date first (a header click re-sorts).
  const sortedPlans = React.useMemo(
    () => [...plans].sort((a, b) => (b.issuedDate ?? "").localeCompare(a.issuedDate ?? "") || b.createdAt.localeCompare(a.createdAt)),
    [plans]
  )
  // Each repair's parts as one line for the Parts column: "013 ×1, 012 ×2 IN".
  const partsByRepairId = React.useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of allParts) {
      const label = `${p.productSku || p.productName || "?"} ×${p.quantity}${p.inOut === "IN" ? " IN" : ""}`
      const list = map.get(p.repairPlanId)
      if (list) list.push(label)
      else map.set(p.repairPlanId, [label])
    }
    return new Map(Array.from(map, ([id, labels]) => [id, labels.join(", ")]))
  }, [allParts])
  const columns = React.useMemo(() => getRepairListColumns(partsByRepairId), [partsByRepairId])
  const plansByAccount = React.useMemo(() => {
    const map = new Map<string, RepairPlan[]>()
    for (const p of sortedPlans) {
      const key = sameAccountKey(p)
      const list = map.get(key)
      if (list) list.push(p)
      else map.set(key, [p])
    }
    return map
  }, [sortedPlans])

  const selection = useSplitViewSelection(filteredRows, initialId)
  useDeepLinkNotFoundToast(initialId, isPending, plans.some((p) => p.id === initialId))

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const selected = selection.selected
  const accountRepairs = selected ? (plansByAccount.get(sameAccountKey(selected)) ?? [selected]) : []

  // RepairDateSwitcher (in RepairPartsSection): jump to another repair of the
  // same account, or move this repair's Issued Date.
  function selectHistoryDate(id: string) {
    const target = accountRepairs.find((p) => p.id === id)
    if (target) selection.open(target)
  }
  function editIssuedDate(newDate: string) {
    if (!selected) return
    updatePlan.mutate({ id: selected.id, input: { issuedDate: newDate } })
  }

  return (
    // h-full: this page's share of <main> is a definite height, so the
    // table's flex-1 share is "whatever's left" and only its own scroll moves.
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

      <SplitViewLayout
        isOpen={selection.isOpen}
        expanded={selection.expanded}
        breakpoint="xl"
        fillHeight
        className="flex-1 min-h-0"
        list={
          <Card className="flex-1 min-h-0">
            <CardContent className="flex flex-1 min-h-0 flex-col pt-6">
              <div className="flex-1 min-h-0 overflow-hidden">
                <DataTable
                  columns={columns}
                  data={sortedPlans}
                  pageSize={REPAIR_PAGE_SIZE}
                  searchPlaceholder={t("searchPlaceholder")}
                  searchFn={matchesRepairSearch}
                  emptyMessage={t("noPlansFound")}
                  onFilteredRowsChange={setFilteredRows}
                  onRowClick={(row) => selection.open(row)}
                  tableClassName="table-fixed min-w-[1360px] w-full"
                  // The table (1360px) is wider than most screens: keep its
                  // horizontal scrollbar drawn instead of an overlay one that
                  // only shows while scrolling (see globals.css).
                  tableContainerClassName="overflow-x-auto scrollbar-always-visible"
                  scrollContainerClassName="overflow-x-auto"
                />
              </div>
            </CardContent>
          </Card>
        }
        detail={
          selected && (
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
              onClose={selection.close}
              extra={
                <RepairPartsSection
                  key={selected.id}
                  repairPlanId={selected.id}
                  canEdit={isAdmin}
                  orderNo={selected.orderNo}
                  defaultDate={selected.issuedDate}
                  historyDates={accountRepairs.map((p) => ({ id: p.id, date: p.issuedDate }))}
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
              <DetailField label={tFields("sc")} value={selected.sc} />
              <DetailField label={tFields("model")} value={selected.model} />
              <DetailField label={tFields("unitInOut")} value={selected.unitInOut} />
              <DetailField label={tFields("problem")} value={selected.problem} className="sm:col-span-2" />
              <DetailField label={tFields("solutionStatus")} value={selected.solutionStatus} className="sm:col-span-2" />
              <DetailField label={tFields("preD")} value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label={tFields("accD")} value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField label={tFields("th")} value={selected.th ? formatTechnicians(selected.th, selected.th2, "&") : selected.th} />
              <DetailField label={tFields("amt")} value={formatCurrency(selected.amt)} />
              <DetailField label={tFields("status")} value={planStatusLabel(selected.status, tStatus)} />
            </DetailPanel>
          )
        }
      />

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
          if (wasSelected) selection.close()
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
