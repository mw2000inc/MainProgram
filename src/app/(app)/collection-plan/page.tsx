"use client"

import * as React from "react"
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
import { useCollections, useDeleteCollections } from "@/lib/hooks/use-collections"
import { useAuth } from "@/lib/auth/auth-context"
import { cn, formatCurrency, formatDate } from "@/lib/utils"
import type { CollectionPlan } from "@/lib/types"

function yearMonth(dateStr: string) {
  return dateStr.slice(0, 7)
}

export default function CollectionPlanPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: entries = [], isPending } = useCollections()
  const deleteEntries = useDeleteCollections()

  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<CollectionPlan | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<CollectionPlan | undefined>(undefined)
  const [filteredRows, setFilteredRows] = React.useState<CollectionPlan[]>(entries)

  const selection = useSplitViewSelection(filteredRows)

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
        onDelete: (e) => setDeleting(e),
      }),
    [isAdmin]
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
            <Banknote className="h-6 w-6 text-primary" /> Collection Plan
          </h1>
          <p className="text-sm text-muted-foreground">Full list of payment collections, grouped by month.</p>
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
            <Plus className="h-4 w-4" /> Add
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
                    All
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
                  searchPlaceholder="Search by order number, account..."
                  emptyMessage="No collections found."
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
              <DetailField label="Order Number" value={selected.orderNo} />
              <DetailField label="Member Account#" value={selected.accountName} />
              <DetailField label="Amount" value={formatCurrency(selected.amount)} />
              <DetailField label="C/T" value={selected.ct} />
              <DetailField label="Plan D" value={formatDate(selected.collectionDate)} />
              <DetailField label="Pre D" value={selected.preD ? formatDate(selected.preD) : undefined} />
              <DetailField label="Acc D" value={selected.accD ? formatDate(selected.accD) : undefined} />
              <DetailField label="Status" value={selected.status} />
              <DetailField label="Note" value={selected.note} className="sm:col-span-2" />
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
        defaultDate={new Date().toISOString().slice(0, 10)}
        entry={editing}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title="Delete this collection?"
        description="This will permanently remove this collection record."
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
