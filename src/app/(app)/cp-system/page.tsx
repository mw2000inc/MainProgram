"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Layers, ClipboardCheck, Wrench, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { BreadcrumbTrail } from "@/components/shared/breadcrumb-trail"
import { DetailField, DetailPanel, SplitViewLayout, useSplitViewSelection } from "@/components/data-table/split-view"
import { OrderRelatedSection } from "@/components/sale-list/order-related-section"
import { getSaleListSummaryColumns } from "@/components/sale-list/sale-list-columns"
import { getRepairColumns } from "@/components/repair/repair-columns"
import { CpSystemFormDialog } from "@/components/cp-systems/cp-system-form-dialog"
import { CpSystemComponentFormDialog } from "@/components/cp-systems/cp-system-component-form-dialog"
import {
  getCpSystemColumns,
  getCpSystemNarrowColumn,
  getCpSystemDetailColumns,
  type CpSystemComponentRow,
} from "@/components/cp-systems/cp-system-columns"
import { useCpSystems, useDeleteCpSystem, useUpdateCpSystem } from "@/lib/hooks/use-cp-systems"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import type { CpSystem, CpSystemComponent } from "@/lib/types"

// Replaces the old AppSheet "MW CP > CP System" reference screen — a catalog
// of system codes and the filter components each is built from. Same
// split-view pattern as Member/Sale List: a flat searchable table, and a
// per-system detail panel (CP_SystemDetails component sub-table + Related
// Sales_Lists/Repairs) once a row is opened. Read-only for staff; admins
// manage it here. Not yet wired into the filter-change scheduling cron (see
// the migration's own comment) — this is just the catalog.
function CpSystemContent() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: systems = [], isPending: p1 } = useCpSystems()

  // Deep link from the Activity Log (?id=<systemId>).
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined
  const { data: saleListEntries = [], isPending: p2 } = useSaleListEntries()
  const { data: repairPlans = [], isPending: p3 } = useRepairPlans()
  const { data: customers = [], isPending: p4 } = useCustomers()
  const deleteSystem = useDeleteCpSystem()
  const updateSystem = useUpdateCpSystem()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CpSystem | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<CpSystem | undefined>(undefined)

  // Add/edit/delete of one CP_SystemDetails row — these mutate the selected
  // system's own `components` array (see CpSystemComponentFormDialog), not a
  // separate table.
  const [componentFormOpen, setComponentFormOpen] = React.useState(false)
  const [editingComponent, setEditingComponent] = React.useState<{ component: CpSystemComponent; index: number } | undefined>(
    undefined
  )
  const [deletingComponentIndex, setDeletingComponentIndex] = React.useState<number | undefined>(undefined)

  const isPending = p1 || p2 || p3 || p4

  const selection = useSplitViewSelection(systems, initialId)
  const selected = selection.selected
  useDeepLinkNotFoundToast(initialId, isPending, systems.some((s) => s.id === initialId))

  const columns = React.useMemo(
    () =>
      getCpSystemColumns({
        canEdit: isAdmin,
        canDelete: isAdmin,
        onEdit: (system) => {
          setEditing(system)
          setFormOpen(true)
        },
        onDelete: (system) => setDeleting(system),
      }),
    [isAdmin]
  )
  const narrowColumns = React.useMemo(() => getCpSystemNarrowColumn(), [])
  const componentRows: CpSystemComponentRow[] = React.useMemo(
    () => (selected ? selected.components.map((c, i) => ({ ...c, id: String(i) })) : []),
    [selected]
  )
  const detailColumns = React.useMemo(
    () =>
      getCpSystemDetailColumns({
        canEdit: isAdmin,
        canDelete: isAdmin,
        onEdit: (row) => {
          setEditingComponent({ component: row, index: Number(row.id) })
          setComponentFormOpen(true)
        },
        onDelete: (row) => setDeletingComponentIndex(Number(row.id)),
      }),
    [isAdmin]
  )
  const repairColumns = React.useMemo(() => getRepairColumns(), [])

  const relatedSaleListRows = React.useMemo(() => {
    if (!selected) return []
    return saleListEntries
      .filter((e) => e.cpSystemId === selected.id)
      .map((e) => {
        const customer = customers.find((c) => c.id === e.customerId)
        return { ...e, accountLabel: customer ? customer.companyName || customer.fullName : "" }
      })
  }, [saleListEntries, customers, selected])

  const relatedRepairs = React.useMemo(() => {
    if (!selected) return []
    const orderNumbers = new Set(relatedSaleListRows.map((e) => e.orderNumber))
    return repairPlans.filter((r) => orderNumbers.has(r.orderNo))
  }, [repairPlans, relatedSaleListRows, selected])

  const saleListSummaryColumns = React.useMemo(() => getSaleListSummaryColumns(), [])

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
            ? [{ label: "MW CP" }, { label: "CP System", onClick: selection.close }, { label: selected.systemCode }]
            : [{ label: "MW CP" }, { label: "CP System" }]
        }
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Layers className="h-6 w-6 text-primary" /> CP System
          </h1>
          <p className="text-sm text-muted-foreground">System codes and the filter components each one is built from.</p>
        </div>
        {isAdmin && (
          <Button
            className="gap-1.5"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        )}
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
                  data={systems}
                  searchPlaceholder="Search by system code..."
                  emptyMessage="No CP Systems defined yet."
                  onRowClick={(row) => selection.open(row)}
                />
              </CardContent>
            </Card>
          }
          detail={
            <DetailPanel
              title={selected.systemCode}
              icon={Layers}
              subtitle="CP System"
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
                <>
                  <OrderRelatedSection
                    title="CP_SystemDetails"
                    icon={Layers}
                    data={componentRows}
                    columns={detailColumns}
                    emptyMessage="No filter components defined yet."
                    canAdd={isAdmin}
                    onAdd={() => {
                      setEditingComponent(undefined)
                      setComponentFormOpen(true)
                    }}
                  />
                  <OrderRelatedSection
                    title="Related Sales_Lists"
                    icon={ClipboardCheck}
                    data={relatedSaleListRows}
                    columns={saleListSummaryColumns}
                    emptyMessage="No sale-list orders linked to this system yet."
                  />
                  <OrderRelatedSection
                    title="Related Repairs"
                    icon={Wrench}
                    data={relatedRepairs}
                    columns={repairColumns}
                    emptyMessage="No repairs linked to this system yet."
                  />
                </>
              }
            >
              <DetailField label="System Code" value={selected.systemCode} className="sm:col-span-2" />
            </DetailPanel>
          }
        />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={systems}
              searchPlaceholder="Search by system code..."
              emptyMessage="No CP Systems defined yet."
              onRowClick={(row) => selection.open(row)}
            />
          </CardContent>
        </Card>
      )}

      <CpSystemFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o)
          if (!o) setEditing(undefined)
        }}
        system={editing}
      />

      {selected && (
        <CpSystemComponentFormDialog
          open={componentFormOpen}
          onOpenChange={(o) => {
            setComponentFormOpen(o)
            if (!o) setEditingComponent(undefined)
          }}
          system={selected}
          editing={editingComponent?.component}
          index={editingComponent?.index}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this CP System?"
        description="This will permanently remove this system code and its component list. Any sale-list orders linked to it will keep their existing data but lose the link."
        loading={deleteSystem.isPending}
        onConfirm={async () => {
          if (!deleting) return
          const wasSelected = selected?.id === deleting.id
          await deleteSystem.mutateAsync(deleting.id)
          setDeleting(undefined)
          if (wasSelected) selection.close()
        }}
      />

      <ConfirmDialog
        open={deletingComponentIndex !== undefined}
        onOpenChange={(o) => !o && setDeletingComponentIndex(undefined)}
        title="Remove this filter component?"
        description="This will permanently remove it from this system's component list."
        loading={updateSystem.isPending}
        onConfirm={async () => {
          if (!selected || deletingComponentIndex === undefined) return
          const components = selected.components.filter((_, i) => i !== deletingComponentIndex)
          await updateSystem.mutateAsync({ id: selected.id, input: { components } })
          setDeletingComponentIndex(undefined)
        }}
      />
    </div>
  )
}

function CpSystemFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function CpSystemPage() {
  return (
    <React.Suspense fallback={<CpSystemFallback />}>
      <CpSystemContent />
    </React.Suspense>
  )
}
