"use client"

import * as React from "react"
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
import { useSettings, useUpdateSettings } from "@/lib/hooks/use-misc"
import { useAuth } from "@/lib/auth/auth-context"
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

// The four plan panels that arrange into a fixed 2x2 grid in "grid" layout
// mode — Filter Change + Installation on top, Repair + Collection below,
// left-to-right in this exact order (matches the old AppSheet reference).
// Not draggable or individually resizable while in that mode, since the
// arrangement is fixed.
const GRID_PANEL_IDS: PanelId[] = ["filter-change", "installation", "repair", "collection"]

// Same fixed, non-draggable/non-resizable treatment as the four above while
// in "grid" mode — rendered as their own side-by-side pair (Announcements
// left, Schedule right) directly above the 2x2 block, not merged into it.
// Date Control is deliberately not in this list: it keeps its handles in
// both modes.
const FROZEN_IN_GRID_IDS: PanelId[] = ["announcements", "schedule"]

// Shared operational panel layout — Announcements, Schedule, the Date Control,
// and the Filter Change/Installation/Repair/Collection panels. Rendered on both
// the Dashboard and the standalone Daily Report page so they stay in sync
// rather than drifting as two separate copies. Panel order is admin-editable
// (drag-and-drop) and persisted to the shared company_settings row, so every
// viewer sees the same saved layout — staff get it read-only, with no handles.
export function DailyReportSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"

  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings(user?.id ?? "")

  // The saved order, derived straight from settings — no effect needed. A local
  // override holds the just-dropped order for immediate feedback until the
  // mutation round-trips and settings refetches to match it.
  const savedOrder = React.useMemo(() => resolveOrder(settings?.dailyReportLayout), [settings])
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
    updateSettings.mutate({ dailyReportLayout: next })
  }

  // Same shared-settings pattern as the order above, but keyed per panel — a
  // local override per panel id holds its just-dropped size for immediate
  // feedback until settings refetches to match.
  const savedSizes = settings?.dailyReportPanelSizes ?? {}
  const [localSizes, setLocalSizes] = React.useState<Record<string, PanelSize>>({})
  const sizes = { ...savedSizes, ...localSizes }

  function handleResizeEnd(panelId: string, size: PanelSize) {
    setLocalSizes((prev) => ({ ...prev, [panelId]: size }))
    updateSettings.mutate({ dailyReportPanelSizes: { ...sizes, [panelId]: size } })
  }

  // Same shared-settings pattern as order/sizes above.
  const savedLayoutMode = settings?.dailyReportLayoutMode ?? "stacked"
  const [localLayoutMode, setLocalLayoutMode] = React.useState<"stacked" | "grid" | null>(null)
  const layoutMode = localLayoutMode ?? savedLayoutMode

  function handleLayoutModeChange(mode: "stacked" | "grid") {
    if (mode === layoutMode) return
    setLocalLayoutMode(mode)
    updateSettings.mutate({ dailyReportLayoutMode: mode })
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

  // Raw panel content, unwrapped — reused as-is inside the fixed grid cells in
  // "grid" mode, and wrapped in ResizablePanel below for "stacked" mode. Only
  // the arrangement changes between modes, never the panel internals.
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
  const firstGridIndex = order.findIndex((id) => GRID_PANEL_IDS.includes(id))
  const firstFrozenIndex = order.findIndex((id) => FROZEN_IN_GRID_IDS.includes(id))
  // In grid mode, the four grid panels and the frozen ones aren't individually
  // sortable — only the remaining ids (Date Control) are real drag targets.
  const sortableItems = isGrid
    ? order.filter((id) => !GRID_PANEL_IDS.includes(id) && !FROZEN_IN_GRID_IDS.includes(id))
    : order

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
        <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {order.map((id, index) => {
              if (GRID_PANEL_IDS.includes(id)) {
                if (!isGrid) {
                  return (
                    <SortablePanel key={id} id={id} isAdmin={isAdmin}>
                      {resizable(id)}
                    </SortablePanel>
                  )
                }
                // Render the whole fixed 2x2 block once, at the position the
                // first grid panel occupies in the saved order — the other
                // three grid-panel ids are skipped below so they don't repeat.
                if (index !== firstGridIndex) return null
                return (
                  <div key="grid-block" className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {GRID_PANEL_IDS.map((gridId) => (
                      <div key={gridId} className="min-w-0">
                        {rawContent[gridId]}
                      </div>
                    ))}
                  </div>
                )
              }
              if (FROZEN_IN_GRID_IDS.includes(id)) {
                if (!isGrid) {
                  return (
                    <SortablePanel key={id} id={id} isAdmin={isAdmin}>
                      {resizable(id)}
                    </SortablePanel>
                  )
                }
                // Same pairing treatment as the 2x2 block below — rendered
                // once, at the position the first of the two occupies in the
                // saved order, side by side, no drag/resize handles.
                if (index !== firstFrozenIndex) return null
                return (
                  <div key="frozen-pair-block" className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {FROZEN_IN_GRID_IDS.map((frozenId) => (
                      <div key={frozenId} className="min-w-0">
                        {rawContent[frozenId]}
                      </div>
                    ))}
                  </div>
                )
              }
              return (
                <SortablePanel key={id} id={id} isAdmin={isAdmin}>
                  {resizable(id)}
                </SortablePanel>
              )
            })}
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
