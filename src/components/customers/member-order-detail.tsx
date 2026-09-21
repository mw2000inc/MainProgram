"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { ColumnDef } from "@tanstack/react-table"
import { ClipboardCheck, Droplets, Banknote, Wrench, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DataTable } from "@/components/data-table/data-table"
import { DetailField, DetailPanel, SplitViewLayout } from "@/components/data-table/split-view"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { OrderRelatedSection } from "@/components/sale-list/order-related-section"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import { getSaleListOrderNumberColumn, type SaleListRow } from "@/components/sale-list/sale-list-columns"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import {
  getFilterChangeDailyReportColumns,
  getFilterChangeExpandedColumns,
  FILTER_CHANGE_EXPORT_COLUMNS,
  type FilterChangeDailyReportPatch,
} from "@/components/filter-change/filter-change-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import {
  getCollectionsColumns,
  getCollectionsDailyReportColumns,
  COLLECTIONS_EXPORT_COLUMNS,
} from "@/components/collections/collections-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useFilterChangePlans, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, todayIso as today } from "@/lib/utils"
import { useAuth, type Permission } from "@/lib/auth/auth-context"
import type { CollectionPlan, Customer, FilterChangePlan, RepairPlan } from "@/lib/types"

// Trailing pencil column that opens the record's own Edit dialog in place —
// sits alongside whatever inline cells the table already has (for the fields
// they don't cover, and Plan D, which is deliberately not inline-editable).
// stopPropagation for the same reason every inline cell has it: it must
// never double as a row click.
function withEditColumn<T>(columns: ColumnDef<T, unknown>[], label: string, onEdit: (row: T) => void): ColumnDef<T, unknown>[] {
  return [
    ...columns,
    {
      id: "edit",
      header: "",
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(row.original)
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ]
}

// The FULL order detail view — same rich content as /sale-list/[id] (core
// order fields plus Related Filter Changes/Collections/Repairs, each with its
// own Add/Expand/Export), reused here in place so an admin can drill from a
// member straight into an order without leaving the Member page. Replaces the
// member's own fields + Related Sales table entirely for as long as an order
// is open; Close/breadcrumb hands control back to the caller.
export function MemberOrderDetail({
  customer,
  entry,
  rows,
  can,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
  onNavigateToList,
  onSelectOrder,
}: {
  customer: Customer
  entry: SaleListRow
  // This member's other related sales — feeds the narrow Order Number list
  // beside the detail panel, so the admin can browse between them without
  // leaving this view.
  rows: SaleListRow[]
  can: (permission: Permission) => boolean
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  // Back up one level, to this order's member (the member's own fields
  // reappear; the order minimizes into a breadcrumb crumb).
  onClose: () => void
  // Back up two levels, all the way to the Member list.
  onNavigateToList: () => void
  // Clicking a different order in the narrow list.
  onSelectOrder: (row: SaleListRow) => void
}) {
  const router = useRouter()
  const { t } = useTranslation("member")
  const { t: tFields } = useTranslation("fields")
  const { t: tCommon } = useTranslation("common")
  const deleteEntries = useDeleteSaleListEntries()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  // Same update hooks the Daily Report's panels use — they invalidate the
  // same query keys this page reads, so an edit here shows up immediately
  // (and on the standalone pages) without a manual refetch. Only `mutate` is
  // taken (a stable callback), not the whole mutation object, which is a new
  // object every render and would rebuild the column defs — remounting every
  // inline cell — on each render.
  const { mutate: updateFilterChangePlan } = useUpdateFilterChangePlan()
  const { mutate: updateCollection } = useUpdateCollection()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [filterFormOpen, setFilterFormOpen] = React.useState(false)
  const [collectionFormOpen, setCollectionFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)
  // The record an Edit pencil opened, if any — same `editing` + form-open
  // pairing the standalone Filter Change/Collection Plan/Repair Plan pages
  // use to drive these same dialogs (see the dialogs' render below).
  const [editingFilterChange, setEditingFilterChange] = React.useState<FilterChangePlan | undefined>(undefined)
  const [editingCollection, setEditingCollection] = React.useState<CollectionPlan | undefined>(undefined)
  const [editingRepair, setEditingRepair] = React.useState<RepairPlan | undefined>(undefined)

  const narrowColumns = React.useMemo(() => getSaleListOrderNumberColumn(), [])
  // The compact Filter Changes card on this page shows exactly 5 fields,
  // in order: Order Number, Filter, Plan D, Pre D, Acc D — the same
  // curated compact set the Daily Report's own Filter Change panel uses
  // (see getFilterChangeDailyReportColumns's own comment), not the plain
  // getFilterChangeColumns() 4-column set (Order Number, Member Account#,
  // Filter, Status) still used read-only elsewhere (Sale List, the
  // customer portal scan view). The Maximize2 dialog keeps the separate,
  // wider getFilterChangeExpandedColumns() set.
  //
  // Admins get the same inline editing as the Daily Report's panels (same
  // cells, same hooks, same rules): Filter Changes' Filter/Pre D/Acc D
  // (+ Serviceman in the wider view), Collections' C/T/Amount/Pre D/Acc D/
  // Note/Serviceman/Status. Plan D stays read-only in both — see
  // FilterChangeDailyReportPatch/CollectionDailyReportPatch for why. Anyone
  // else (onFieldChange undefined) gets the plain read-only columns.
  const filterChangeColumnParams = React.useMemo(
    () => ({
      onFieldChange: isAdmin
        ? (plan: FilterChangePlan, patch: FilterChangeDailyReportPatch) => updateFilterChangePlan({ id: plan.id, input: patch })
        : undefined,
    }),
    [isAdmin, updateFilterChangePlan]
  )
  //
  // The trailing Edit pencil (all three tables, admin only — the dialogs'
  // writes are admin-only under RLS, same as the inline cells) opens the
  // record's real Edit dialog in place, for everything the inline cells
  // don't cover.
  const filterChangeColumns = React.useMemo(() => {
    const columns = getFilterChangeDailyReportColumns(filterChangeColumnParams)
    return isAdmin ? withEditColumn(columns, tCommon("edit"), setEditingFilterChange) : columns
  }, [filterChangeColumnParams, isAdmin, tCommon])
  const filterChangeExpandedColumns = React.useMemo(() => {
    const columns = getFilterChangeExpandedColumns(filterChangeColumnParams)
    return isAdmin ? withEditColumn(columns, tCommon("edit"), setEditingFilterChange) : columns
  }, [filterChangeColumnParams, isAdmin, tCommon])
  // Non-admins keep the plain base column set exactly as before; only an
  // admin switches to the Daily Report variant, the one that carries the
  // inline cells.
  const collectionsColumns = React.useMemo(
    () =>
      isAdmin
        ? withEditColumn(
            getCollectionsDailyReportColumns({
              onStatusChange: (record, status) => updateCollection({ id: record.id, input: { status } }),
              onFieldChange: (record, patch) => updateCollection({ id: record.id, input: patch }),
            }),
            tCommon("edit"),
            setEditingCollection
          )
        : getCollectionsColumns(),
    [isAdmin, updateCollection, tCommon]
  )
  const repairColumns = React.useMemo(() => {
    const columns = getRepairColumns()
    return isAdmin ? withEditColumn(columns, tCommon("edit"), setEditingRepair) : columns
  }, [isAdmin, tCommon])

  const orderFilterChanges = React.useMemo(
    () => filterChangePlans.filter((p) => p.orderNumber === entry.orderNumber),
    [filterChangePlans, entry]
  )
  const orderCollections = React.useMemo(
    () => collections.filter((c) => c.orderNo === entry.orderNumber),
    [collections, entry]
  )
  const orderRepairs = React.useMemo(
    () => repairPlans.filter((r) => r.orderNo === entry.orderNumber),
    [repairPlans, entry]
  )

  const accountLabel = customer.companyName || customer.fullName

  return (
    <>
      <BreadcrumbTrail
        items={[
          { label: t("breadcrumbMember"), onClick: onNavigateToList },
          { label: accountLabel, onClick: onClose },
          { label: entry.orderNumber },
        ]}
      />

      <SplitViewLayout
        isOpen
        expanded={false}
        listWidth="narrow"
        list={
          <Card>
            <CardContent className="pt-6">
              <DataTable
                columns={narrowColumns}
                data={rows}
                searchPlaceholder={t("searchByOrderNumber")}
                emptyMessage={t("noRelatedSales")}
                onRowClick={onSelectOrder}
              />
            </CardContent>
          </Card>
        }
        detail={
          <DetailPanel
            title={entry.orderNumber}
            icon={ClipboardCheck}
            subtitle={accountLabel}
            onEdit={can("sales:edit") ? () => setFormOpen(true) : undefined}
            onDelete={can("sales:delete") ? () => setDeleting(true) : undefined}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
            expanded={false}
            // Opens the standalone order page (its own URL, for linking/printing)
            // without losing this in-place view.
            onToggleExpand={() => router.push(`/sale-list/${entry.id}`)}
            onClose={onClose}
            extra={
              <>
                {/* Filter Changes/Collections side by side, Repairs full-width
                    below — matches the AppSheet order view's layout. */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <OrderRelatedSection
                    title={t("filterChangesSection")}
                    icon={Droplets}
                    data={orderFilterChanges}
                    dateKey="planDate"
                    columns={filterChangeColumns}
                    expandedColumns={filterChangeExpandedColumns}
                    exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
                    exportFileName={`filter-changes-${entry.orderNumber}`}
                    emptyMessage={t("noFilterChangeHistory")}
                    canAdd
                    onAdd={() => setFilterFormOpen(true)}
                    tableContainerClassName="overflow-x-auto scrollbar-always-visible"
                    tableClassName="min-w-[1000px] w-full"
                  />
                  <OrderRelatedSection
                    title={t("collectionsSection")}
                    icon={Banknote}
                    data={orderCollections}
                    dateKey="collectionDate"
                    columns={collectionsColumns}
                    exportColumns={COLLECTIONS_EXPORT_COLUMNS}
                    exportFileName={`collections-${entry.orderNumber}`}
                    emptyMessage={t("noCollectionHistory")}
                    canAdd
                    onAdd={() => setCollectionFormOpen(true)}
                    tableContainerClassName="overflow-x-auto scrollbar-always-visible"
                    tableClassName="min-w-[1000px] w-full"
                  />
                </div>
                {/* Explicit mt-6 (on top of the grid's own gap-6, which only
                    ever spaces its own two children) + clear-both — this
                    section renders full-width directly below the Filter
                    Changes/Collections grid above, and needs its own
                    guaranteed clearance so it can never crowd or overlap
                    that grid's bottom edge (e.g. Filter Changes' own
                    pagination bar) regardless of how tall either grid cell
                    ends up. */}
                <div className="mt-6 clear-both">
                  <OrderRelatedSection
                    title={t("repairsSection")}
                    icon={Wrench}
                    data={orderRepairs}
                    columns={repairColumns}
                    exportColumns={REPAIR_EXPORT_COLUMNS}
                    exportFileName={`repairs-${entry.orderNumber}`}
                    emptyMessage={t("noRepairHistory")}
                    canAdd
                    onAdd={() => setRepairFormOpen(true)}
                    headerAlwaysRow
                  />
                </div>
              </>
            }
          >
            {/* Single-column, one field per row — matches the AppSheet order
                detail view's layout instead of the app-wide 2-column grid. */}
            <DetailField label={tFields("orderNumber")} value={entry.orderNumber} className="sm:col-span-2" />
            <DetailField
              label={tFields("installedDate")}
              value={entry.installedDate ? formatDate(entry.installedDate) : undefined}
              className="sm:col-span-2"
            />
            <DetailField label={tFields("account")} value={entry.accountLabel} className="sm:col-span-2" />
            <DetailField label={tFields("productNo")} value={entry.productNo} className="sm:col-span-2" />
            <DetailField label={tFields("sc")} value={entry.sc} className="sm:col-span-2" />
            <DetailField label={tFields("cf")} value={entry.cf} className="sm:col-span-2" />
            <DetailField label={tFields("ct")} value={entry.ct} className="sm:col-span-2" />
            <DetailField label={tFields("cpY1Y2")} value={entry.cpY1Y2} className="sm:col-span-2" />
            <DetailField
              label={tFields("cpStart")}
              value={entry.cpStart ? formatDate(entry.cpStart) : undefined}
              className="sm:col-span-2"
            />
            <DetailField
              label={tFields("cpEnd")}
              value={entry.cpEnd ? formatDate(entry.cpEnd) : undefined}
              className="sm:col-span-2"
            />
          </DetailPanel>
        }
      />

      <SaleListFormDialog open={formOpen} onOpenChange={setFormOpen} entry={entry} defaultCustomerId={customer.id} />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteSaleListEntryTitle")}
        description={t("deleteSaleListEntryDescription")}
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          await deleteEntries.mutateAsync([entry.id])
          setDeleting(false)
          onClose()
        }}
      />

      <FilterChangeFormDialog
        open={filterFormOpen || !!editingFilterChange}
        onOpenChange={(o) => {
          setFilterFormOpen(o)
          if (!o) setEditingFilterChange(undefined)
        }}
        defaultDate={today()}
        defaultOrderNumber={entry.orderNumber}
        plan={editingFilterChange}
      />
      <CollectionsFormDialog
        open={collectionFormOpen || !!editingCollection}
        onOpenChange={(o) => {
          setCollectionFormOpen(o)
          if (!o) setEditingCollection(undefined)
        }}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
        entry={editingCollection}
      />
      <RepairFormDialog
        open={repairFormOpen || !!editingRepair}
        onOpenChange={(o) => {
          setRepairFormOpen(o)
          if (!o) setEditingRepair(undefined)
        }}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
        plan={editingRepair}
      />
    </>
  )
}
