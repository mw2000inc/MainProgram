"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ClipboardCheck, Droplets, Banknote, Wrench } from "lucide-react"
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
} from "@/components/filter-change/filter-change-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { getCollectionsColumns, COLLECTIONS_EXPORT_COLUMNS } from "@/components/collections/collections-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { formatDate, todayIso as today } from "@/lib/utils"
import type { Permission } from "@/lib/auth/auth-context"
import type { Customer } from "@/lib/types"

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
  const deleteEntries = useDeleteSaleListEntries()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()

  const [formOpen, setFormOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [filterFormOpen, setFilterFormOpen] = React.useState(false)
  const [collectionFormOpen, setCollectionFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)

  const narrowColumns = React.useMemo(() => getSaleListOrderNumberColumn(), [])
  // The compact Filter Changes card on this page shows exactly 5 fields,
  // in order: Order Number, Filter, Plan D, Pre D, Acc D — the same
  // curated compact set the Daily Report's own Filter Change panel uses
  // (see getFilterChangeDailyReportColumns's own comment), not the plain
  // getFilterChangeColumns() 4-column set (Order Number, Member Account#,
  // Filter, Status) still used read-only elsewhere (Sale List, the
  // customer portal scan view). Read-only here (no onStatusChange/
  // onFieldChange) — this page has never supported inline-editing these
  // rows. The Maximize2 dialog keeps the separate, wider
  // getFilterChangeExpandedColumns() set unchanged.
  const filterChangeColumns = React.useMemo(() => getFilterChangeDailyReportColumns(), [])
  const filterChangeExpandedColumns = React.useMemo(() => getFilterChangeExpandedColumns(), [])
  const collectionsColumns = React.useMemo(() => getCollectionsColumns(), [])
  const repairColumns = React.useMemo(() => getRepairColumns(), [])

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
          { label: "Member", onClick: onNavigateToList },
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
                searchPlaceholder="Search by order number..."
                emptyMessage="No related sales for this member."
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
                    title="Filter Changes"
                    icon={Droplets}
                    data={orderFilterChanges}
                    dateKey="planDate"
                    columns={filterChangeColumns}
                    expandedColumns={filterChangeExpandedColumns}
                    exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
                    exportFileName={`filter-changes-${entry.orderNumber}`}
                    emptyMessage="No filter change history for this order."
                    canAdd
                    onAdd={() => setFilterFormOpen(true)}
                    tableContainerClassName="overflow-x-auto scrollbar-always-visible"
                    tableClassName="min-w-[1000px] w-full"
                  />
                  <OrderRelatedSection
                    title="Collections"
                    icon={Banknote}
                    data={orderCollections}
                    dateKey="collectionDate"
                    columns={collectionsColumns}
                    exportColumns={COLLECTIONS_EXPORT_COLUMNS}
                    exportFileName={`collections-${entry.orderNumber}`}
                    emptyMessage="No collection history for this order."
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
                    title="Repairs"
                    icon={Wrench}
                    data={orderRepairs}
                    columns={repairColumns}
                    exportColumns={REPAIR_EXPORT_COLUMNS}
                    exportFileName={`repairs-${entry.orderNumber}`}
                    emptyMessage="No repair history for this order."
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
            <DetailField label="Order Number" value={entry.orderNumber} className="sm:col-span-2" />
            <DetailField
              label="Installed Date"
              value={entry.installedDate ? formatDate(entry.installedDate) : undefined}
              className="sm:col-span-2"
            />
            <DetailField label="Account#" value={entry.accountLabel} className="sm:col-span-2" />
            <DetailField label="Product#" value={entry.productNo} className="sm:col-span-2" />
            <DetailField label="S/C" value={entry.sc} className="sm:col-span-2" />
            <DetailField label="C/F" value={entry.cf} className="sm:col-span-2" />
            <DetailField label="C/T" value={entry.ct} className="sm:col-span-2" />
            <DetailField label="CP y1/y2" value={entry.cpY1Y2} className="sm:col-span-2" />
            <DetailField
              label="CP start"
              value={entry.cpStart ? formatDate(entry.cpStart) : undefined}
              className="sm:col-span-2"
            />
            <DetailField
              label="CP end"
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
        title="Delete this sale list entry?"
        description="This will permanently remove this record."
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          await deleteEntries.mutateAsync([entry.id])
          setDeleting(false)
          onClose()
        }}
      />

      <FilterChangeFormDialog
        open={filterFormOpen}
        onOpenChange={setFilterFormOpen}
        defaultDate={today()}
        defaultOrderNumber={entry.orderNumber}
      />
      <CollectionsFormDialog
        open={collectionFormOpen}
        onOpenChange={setCollectionFormOpen}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
      />
      <RepairFormDialog
        open={repairFormOpen}
        onOpenChange={setRepairFormOpen}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
      />
    </>
  )
}
