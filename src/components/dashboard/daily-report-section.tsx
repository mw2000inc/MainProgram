"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { Droplets, HardHat, Wrench, Banknote, Rows3, LayoutGrid } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnnouncementPanel } from "@/components/announcements/announcement-panel"
import { DateControl } from "@/components/dashboard/date-control"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SortablePanel } from "@/components/dashboard/sortable-panel"
import { ResizablePanel } from "@/components/dashboard/resizable-panel"
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda"
import {
  getFilterChangeColumns,
  getFilterChangeExpandedColumns,
  FILTER_CHANGE_EXPORT_COLUMNS,
} from "@/components/filter-change/filter-change-columns"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getInstallColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getCollectionsColumns, COLLECTIONS_EXPORT_COLUMNS } from "@/components/collections/collections-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { useFilterChangePlans, useDeleteFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans, useDeleteInstallPlans } from "@/lib/hooks/use-install-plans"
import { useRepairPlans, useDeleteRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCollections, useDeleteCollections } from "@/lib/hooks/use-collections"
import { useMyDailyReportLayout, useSaveMyDailyReportLayout } from "@/lib/hooks/use-daily-report-layout"
import { useAuth } from "@/lib/auth/auth-context"
import { useReportDetailPanelOpen } from "@/lib/sidebar-collapse-context"
import type { PanelSize } from "@/lib/types"

function today() {
  return new Date().toISOString().slice(0, 10)
}

// The default order, and the full set of valid panel ids. Adding a new panel
// later just means appending its id here — resolveOrder() below automatically
// tacks it onto the end of anyone's already-saved custom order.
const DEFAULT_PANEL_ORDER = [
  "announcements",
  "schedule",
  "date",
  "filter-change",
  "installation",
  "repair",
  "collection",
] as const

type PanelId = (typeof DEFAULT_PANEL_ORDER)[number]

function resolveOrder(saved: string[] | undefined): PanelId[] {
  const known = new Set<string>(DEFAULT_PANEL_ORDER)
  const savedValid = (saved ?? []).filter((id): id is PanelId => known.has(id))
  const missing = DEFAULT_PANEL_ORDER.filter((id) => !savedValid.includes(id))
  return [...savedValid, ...missing]
}

// Every panel is freely draggable and resizable by admins in both layout
// modes — "stacked" lays them out one per row; "grid" wraps them left-to-
// right based on each panel's own width, so resizing narrower fits more per
// row. Shared operational panel layout — Announcements, Schedule, the Date
// Control, and the Filter Change/Installation/Repair/Collection panels.
// Rendered on both the Dashboard and the standalone Daily Report page so they
// stay in sync rather than drifting as two separate copies. Order/sizes/mode
// are saved per-admin (see use-daily-report-layout.ts) — each admin has their
// own arrangement; staff always see the fixed default, read-only.
export function DailyReportSection() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  // Same collapse mechanism as a split-view detail panel — the nav rail goes
  // icon-only for as long as this section is mounted (i.e. the Daily Report
  // page is active) and re-expands on navigating away, via the effect's
  // cleanup unregistering it. Reference-counted, so it coexists cleanly with
  // any split-view panel collapse request elsewhere.
  useReportDetailPanelOpen(true)

  // Staff never fetch or save a layout at all (the query is disabled below) —
  // they always render the hardcoded default order/sizes/mode.
  const { data: myLayout } = useMyDailyReportLayout(isAdmin ? user?.id : undefined)
  const saveLayout = useSaveMyDailyReportLayout(user?.id)

  // The saved order, derived straight from the fetched layout — no effect
  // needed. A local override holds the just-dropped order for immediate
  // feedback until the mutation round-trips and the layout refetches to match.
  const savedOrder = React.useMemo(() => resolveOrder(myLayout?.layout), [myLayout])
  const [localOrder, setLocalOrder] = React.useState<PanelId[] | null>(null)
  const order = localOrder ?? savedOrder

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.indexOf(active.id as PanelId)
    const newIndex = order.indexOf(over.id as PanelId)
    const next = arrayMove(order, oldIndex, newIndex)
    setLocalOrder(next)
    saveLayout.mutate({ layout: next })
  }

  // Same saved-layout pattern as the order above, but keyed per panel — a
  // local override per panel id holds its just-dropped size for immediate
  // feedback until the layout refetches to match.
  const savedSizes = myLayout?.panelSizes ?? {}
  const [localSizes, setLocalSizes] = React.useState<Record<string, PanelSize>>({})
  const sizes = { ...savedSizes, ...localSizes }

  function handleResizeEnd(panelId: string, size: PanelSize) {
    setLocalSizes((prev) => ({ ...prev, [panelId]: size }))
    saveLayout.mutate({ panelSizes: { ...sizes, [panelId]: size } })
  }

  // Same saved-layout pattern as order/sizes above.
  const savedLayoutMode = myLayout?.layoutMode ?? "stacked"
  const [localLayoutMode, setLocalLayoutMode] = React.useState<"stacked" | "grid" | null>(null)
  const layoutMode = localLayoutMode ?? savedLayoutMode

  function handleLayoutModeChange(mode: "stacked" | "grid") {
    if (mode === layoutMode) return
    setLocalLayoutMode(mode)
    saveLayout.mutate({ layoutMode: mode })
  }

  const [reportDate, setReportDate] = React.useState(today)

  const { data: filterChangePlans = [], isPending: pFilter } = useFilterChangePlans()
  const { data: installPlans = [], isPending: pInstall } = useInstallPlans()
  const { data: repairPlans = [], isPending: pRepair } = useRepairPlans()
  const { data: collectionPlans = [], isPending: pCollections } = useCollections()

  const deleteFilterChangePlans = useDeleteFilterChangePlans()
  const deleteInstallPlans = useDeleteInstallPlans()
  const deleteRepairPlans = useDeleteRepairPlans()
  const deleteCollections = useDeleteCollections()

  const [filterChangeFormOpen, setFilterChangeFormOpen] = React.useState(false)
  const [installFormOpen, setInstallFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)
  const [collectionsFormOpen, setCollectionsFormOpen] = React.useState(false)

  const filterChangeColumns = React.useMemo(() => getFilterChangeColumns(), [])
  const filterChangeExpandedColumns = React.useMemo(() => getFilterChangeExpandedColumns(), [])
  const installColumns = React.useMemo(() => getInstallColumns(), [])
  const repairColumns = React.useMemo(() => getRepairColumns(), [])
  const collectionsColumns = React.useMemo(() => getCollectionsColumns(), [])

  const dayFilterChangePlans = React.useMemo(
    () => filterChangePlans.filter((p) => p.planDate === reportDate),
    [filterChangePlans, reportDate]
  )
  const dayInstallPlans = React.useMemo(
    () => installPlans.filter((p) => p.inputDate === reportDate),
    [installPlans, reportDate]
  )
  const dayRepairPlans = React.useMemo(
    () => repairPlans.filter((p) => p.issuedDate === reportDate),
    [repairPlans, reportDate]
  )
  const dayCollectionPlans = React.useMemo(
    () => collectionPlans.filter((p) => p.collectionDate === reportDate),
    [collectionPlans, reportDate]
  )

  // Raw panel content, unwrapped — always wrapped in SortablePanel +
  // ResizablePanel below (see resizable()); only the outer arrangement
  // differs between "stacked" and "grid" mode, never the panel internals.
  const rawContent: Record<PanelId, React.ReactNode> = {
    announcements: <AnnouncementPanel />,
    schedule: <ScheduleAgenda date={reportDate} />,
    date: <DateControl value={reportDate} onChange={setReportDate} />,
    "filter-change": (
      <DashboardPlanPanel
        title="Filter Change Plan"
        icon={Droplets}
        columns={filterChangeColumns}
        expandedColumns={filterChangeExpandedColumns}
        data={dayFilterChangePlans}
        loading={pFilter}
        emptyMessage="No filter change plans for this date."
        canAdd
        addLabel="Add"
        onAdd={() => setFilterChangeFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteFilterChangePlans.mutateAsync(ids)}
        exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
        exportFileName="filter-change-plan"
        onRowClick={(row) => router.push(`/filter-change?id=${row.id}`)}
      />
    ),
    installation: (
      <DashboardPlanPanel
        title="Installation Plan"
        icon={HardHat}
        columns={installColumns}
        data={dayInstallPlans}
        loading={pInstall}
        emptyMessage="No installs for this date."
        canAdd
        addLabel="Add"
        onAdd={() => setInstallFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteInstallPlans.mutateAsync(ids)}
        exportColumns={INSTALL_EXPORT_COLUMNS}
        exportFileName="install-plan"
        onRowClick={(row) => router.push(`/install?id=${row.id}`)}
      />
    ),
    repair: (
      <DashboardPlanPanel
        title="Repair Plan"
        icon={Wrench}
        columns={repairColumns}
        data={dayRepairPlans}
        loading={pRepair}
        emptyMessage="No repair plans for this date."
        canAdd
        addLabel="Add"
        onAdd={() => setRepairFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteRepairPlans.mutateAsync(ids)}
        exportColumns={REPAIR_EXPORT_COLUMNS}
        exportFileName="repair-plan"
        onRowClick={(row) => router.push(`/repair-plan?id=${row.id}`)}
      />
    ),
    collection: (
      <DashboardPlanPanel
        title="Collection Plan"
        icon={Banknote}
        columns={collectionsColumns}
        data={dayCollectionPlans}
        loading={pCollections}
        emptyMessage="No collections for this date."
        canAdd
        addLabel="Add"
        onAdd={() => setCollectionsFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteCollections.mutateAsync(ids)}
        exportColumns={COLLECTIONS_EXPORT_COLUMNS}
        exportFileName="collection-plan"
        onRowClick={(row) => router.push(`/collection-plan?id=${row.id}`)}
      />
    ),
  }

  function resizable(id: PanelId) {
    return (
      <ResizablePanel panelId={id} isAdmin={isAdmin} savedSize={sizes[id]} onResizeEnd={handleResizeEnd}>
        {rawContent[id]}
      </ResizablePanel>
    )
  }

  const isGrid = layoutMode === "grid"
  // Every panel is a real drag target in both modes now — nothing is frozen
  // or grouped into a fixed block.
  const sortableItems = order

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Layout:</span>
          <div className="inline-flex rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={layoutMode === "stacked" ? "default" : "ghost"}
              className="gap-1.5"
              onClick={() => handleLayoutModeChange("stacked")}
            >
              <Rows3 className="h-3.5 w-3.5" /> Stacked
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isGrid ? "default" : "ghost"}
              className="gap-1.5"
              onClick={() => handleLayoutModeChange("grid")}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Grid
            </Button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableItems} strategy={isGrid ? rectSortingStrategy : verticalListSortingStrategy}>
          <div className={isGrid ? "flex flex-wrap items-start gap-6" : "space-y-6"}>
            {order.map((id) => (
              <SortablePanel
                key={id}
                id={id}
                isAdmin={isAdmin}
                width={sizes[id]?.width}
                defaultWidthClassName={isGrid ? "w-full md:w-[calc(50%-12px)]" : "w-full"}
              >
                {resizable(id)}
              </SortablePanel>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <FilterChangeFormDialog open={filterChangeFormOpen} onOpenChange={setFilterChangeFormOpen} defaultDate={reportDate} />
      <InstallFormDialog open={installFormOpen} onOpenChange={setInstallFormOpen} defaultDate={reportDate} />
      <RepairFormDialog open={repairFormOpen} onOpenChange={setRepairFormOpen} defaultDate={reportDate} />
      <CollectionsFormDialog open={collectionsFormOpen} onOpenChange={setCollectionsFormOpen} defaultDate={reportDate} />
    </div>
  )
}
