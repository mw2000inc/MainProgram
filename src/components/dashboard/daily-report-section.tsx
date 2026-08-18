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
import { Droplets, HardHat, Wrench, Banknote } from "lucide-react"
import { AnnouncementPanel } from "@/components/announcements/announcement-panel"
import { DateControl } from "@/components/dashboard/date-control"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SortablePanel } from "@/components/dashboard/sortable-panel"
import { ResizablePanel } from "@/components/dashboard/resizable-panel"
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda"
import { getFilterChangeColumns, getFilterChangeExpandedColumns } from "@/components/filter-change/filter-change-columns"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getInstallColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getCollectionsColumns } from "@/components/collections/collections-columns"
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

  const panels: Record<PanelId, React.ReactNode> = {
    announcements: (
      <ResizablePanel panelId="announcements" isAdmin={isAdmin} savedSize={sizes.announcements} onResizeEnd={handleResizeEnd}>
        <AnnouncementPanel />
      </ResizablePanel>
    ),
    schedule: (
      <ResizablePanel panelId="schedule" isAdmin={isAdmin} savedSize={sizes.schedule} onResizeEnd={handleResizeEnd}>
        <ScheduleAgenda date={reportDate} />
      </ResizablePanel>
    ),
    date: <DateControl value={reportDate} onChange={setReportDate} />,
    "filter-change": (
      <ResizablePanel
        panelId="filter-change"
        isAdmin={isAdmin}
        savedSize={sizes["filter-change"]}
        onResizeEnd={handleResizeEnd}
      >
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
        />
      </ResizablePanel>
    ),
    installation: (
      <ResizablePanel panelId="installation" isAdmin={isAdmin} savedSize={sizes.installation} onResizeEnd={handleResizeEnd}>
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
      </ResizablePanel>
    ),
    repair: (
      <ResizablePanel panelId="repair" isAdmin={isAdmin} savedSize={sizes.repair} onResizeEnd={handleResizeEnd}>
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
      </ResizablePanel>
    ),
    collection: (
      <ResizablePanel panelId="collection" isAdmin={isAdmin} savedSize={sizes.collection} onResizeEnd={handleResizeEnd}>
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
        />
      </ResizablePanel>
    ),
  }

  return (
    <div className="space-y-6">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-6">
            {order.map((id) => (
              <SortablePanel key={id} id={id} isAdmin={isAdmin}>
                {panels[id]}
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
