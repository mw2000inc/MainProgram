"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ClipboardCheck, Droplets, Banknote, Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PanelExportMenu } from "@/components/dashboard/panel-export-menu"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { OrderRelatedSection } from "@/components/sale-list/order-related-section"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import {
  getSaleListColumns,
  getSaleListOrderNumberColumn,
  getSaleListRowClassName,
  SALE_LIST_EXPORT_COLUMNS,
  type SaleListRow,
} from "@/components/sale-list/sale-list-columns"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getFilterChangeColumns, getFilterChangeExpandedColumns, FILTER_CHANGE_EXPORT_COLUMNS } from "@/components/filter-change/filter-change-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { getCollectionsColumns, COLLECTIONS_EXPORT_COLUMNS } from "@/components/collections/collections-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useDeleteSaleListEntries, useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDate, todayIso as today } from "@/lib/utils"

export default function SaleListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: entries = [], isPending: p1 } = useSaleListEntries()
  const { data: customers = [], isPending: p2 } = useCustomers()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const deleteEntries = useDeleteSaleListEntries()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<SaleListRow | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<SaleListRow | undefined>(undefined)
  const [filterFormOpen, setFilterFormOpen] = React.useState(false)
  const [collectionFormOpen, setCollectionFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)

  const isPending = p1 || p2

  const filterChangeColumns = React.useMemo(() => getFilterChangeColumns(), [])
  const filterChangeExpandedColumns = React.useMemo(() => getFilterChangeExpandedColumns(), [])
  const collectionsColumns = React.useMemo(() => getCollectionsColumns(), [])
  const repairColumns = React.useMemo(() => getRepairColumns(), [])

  const rows: SaleListRow[] = React.useMemo(
    () =>
      entries.map((e) => {
        const customer = customers.find((c) => c.id === e.customerId)
        const accountLabel = customer
          ? `${customer.memberAccountNumber ? customer.memberAccountNumber + " — " : ""}${customer.companyName || customer.fullName}`
          : ""
        return { ...e, accountLabel }
      }),
    [entries, customers]
  )

  // Drives both modes: closed = the full-width table below; open = the
  // narrow Order-Number list + detail panel split. Fed the full unfiltered
  // `rows` (not a search-narrowed subset) so Previous/Next and the narrow
  // list always cover every order, matching "keep scrolling and clicking
  // through other orders without leaving this mode."
  const selection = useSplitViewSelection(rows)
  const selected = selection.selected

  const tableColumns = React.useMemo(
    () =>
      getSaleListColumns({
        canEdit: isAdmin,
        canDelete: isAdmin,
        onEdit: (entry) => {
          setEditing(entry)
          setFormOpen(true)
        },
        onDelete: (entry) => setDeleting(entry),
      }),
    [isAdmin]
  )
  const narrowColumns = React.useMemo(() => getSaleListOrderNumberColumn(), [])

  const orderFilterChanges = React.useMemo(
    () => (selected ? filterChangePlans.filter((p) => p.orderNumber === selected.orderNumber) : []),
    [filterChangePlans, selected]
  )
  const orderCollections = React.useMemo(
    () => (selected ? collections.filter((c) => c.orderNo === selected.orderNumber) : []),
    [collections, selected]
  )
  const orderRepairs = React.useMemo(
    () => (selected ? repairPlans.filter((r) => r.orderNo === selected.orderNumber) : []),
    [repairPlans, selected]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <BreadcrumbTrail
        items={
          selected
            ? [{ label: "MW CP" }, { label: "Sales List", onClick: selection.close }, { label: selected.orderNumber }]
            : [{ label: "MW CP" }, { label: "Sales List" }]
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-primary" /> Sale List
          </h1>
          <p className="text-sm text-muted-foreground">Per-member install and care-plan coverage.</p>
        </div>
        <div className="flex items-center gap-2">
          <PanelExportMenu columns={SALE_LIST_EXPORT_COLUMNS} rows={rows} fileName="sale-list" />
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>

      {selected ? (
        <SplitViewLayout
          isOpen={selection.isOpen}
          expanded={selection.expanded}
          listWidth="narrow"
          list={
            <Card>
              <CardContent className="pt-6">
                <DataTable
                  columns={narrowColumns}
                  data={rows}
                  searchPlaceholder="Search by order number..."
                  emptyMessage="No sale list entries found."
                  getRowClassName={getSaleListRowClassName}
                  onRowClick={(row) => selection.open(row)}
                />
              </CardContent>
            </Card>
          }
          detail={
            <DetailPanel
              title={selected.accountLabel || selected.orderNumber}
              icon={ClipboardCheck}
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
              // Expand goes to the full order detail page (with related Filter
              // Changes/Collections/Repairs) instead of a generic fullscreen
              // field dump, since that richer page already exists.
              onToggleExpand={() => router.push(`/sale-list/${selected.id}`)}
              onClose={selection.close}
              extra={
                <>
                  <OrderRelatedSection
                    title="Filter Changes"
                    icon={Droplets}
                    data={orderFilterChanges}
                    dateKey="planDate"
                    columns={filterChangeColumns}
                    expandedColumns={filterChangeExpandedColumns}
                    exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
                    exportFileName={`filter-changes-${selected.orderNumber}`}
                    emptyMessage="No filter change history for this order."
                    canAdd
                    onAdd={() => setFilterFormOpen(true)}
                  />
                  <OrderRelatedSection
                    title="Collections"
                    icon={Banknote}
                    data={orderCollections}
                    dateKey="collectionDate"
                    columns={collectionsColumns}
                    exportColumns={COLLECTIONS_EXPORT_COLUMNS}
                    exportFileName={`collections-${selected.orderNumber}`}
                    emptyMessage="No collection history for this order."
                    canAdd
                    onAdd={() => setCollectionFormOpen(true)}
                  />
                  <OrderRelatedSection
                    title="Repairs"
                    icon={Wrench}
                    data={orderRepairs}
                    columns={repairColumns}
                    exportColumns={REPAIR_EXPORT_COLUMNS}
                    exportFileName={`repairs-${selected.orderNumber}`}
                    emptyMessage="No repair history for this order."
                    canAdd
                    onAdd={() => setRepairFormOpen(true)}
                  />
                </>
              }
            >
              <DetailField label="Order Number" value={selected.orderNumber} />
              <DetailField
                label="Installed Date"
                value={selected.installedDate ? formatDate(selected.installedDate) : undefined}
              />
              <DetailField label="Account#" value={selected.accountLabel} />
              <DetailField label="Product#" value={selected.productNo} />
              <DetailField label="S/C" value={selected.sc} />
              <DetailField label="C/F" value={selected.cf} />
              <DetailField label="C/T" value={selected.ct} />
              <DetailField label="CP y1/y2" value={selected.cpY1Y2} />
              <DetailField label="CP start" value={selected.cpStart ? formatDate(selected.cpStart) : undefined} />
              <DetailField label="CP end" value={selected.cpEnd ? formatDate(selected.cpEnd) : undefined} />
              <DetailField label="Status" value={selected.status} />
              <DetailField label="Note" value={selected.note} className="sm:col-span-2" />
            </DetailPanel>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={tableColumns}
              data={rows}
              searchPlaceholder="Search by order number, account, product..."
              emptyMessage="No sale list entries found."
              getRowClassName={getSaleListRowClassName}
              onRowClick={(row) => selection.open(row)}
            />
          </CardContent>
        </Card>
      )}

      <SaleListFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        entry={editing}
      />

      <FilterChangeFormDialog
        open={filterFormOpen}
        onOpenChange={setFilterFormOpen}
        defaultDate={today()}
        defaultOrderNumber={selected?.orderNumber}
      />
      <CollectionsFormDialog
        open={collectionFormOpen}
        onOpenChange={setCollectionFormOpen}
        defaultDate={today()}
        defaultOrderNo={selected?.orderNumber}
      />
      <RepairFormDialog
        open={repairFormOpen}
        onOpenChange={setRepairFormOpen}
        defaultDate={today()}
        defaultOrderNo={selected?.orderNumber}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this sale list entry?"
        description="This will permanently remove this record."
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
