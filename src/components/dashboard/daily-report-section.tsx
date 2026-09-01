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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import type { ColumnDef } from "@tanstack/react-table"
import { Droplets, HardHat, Wrench, Banknote, Rows3, LayoutGrid, Package, ClipboardCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnnouncementPanel } from "@/components/announcements/announcement-panel"
import { DateControl } from "@/components/dashboard/date-control"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SortablePanel } from "@/components/dashboard/sortable-panel"
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda"
import {
  getFilterChangeDailyReportColumns,
  getFilterChangeExpandedColumns,
  FILTER_CHANGE_EXPORT_COLUMNS,
} from "@/components/filter-change/filter-change-columns"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getInstallColumns, INSTALL_EXPORT_COLUMNS } from "@/components/install/install-columns"
import { InstallFormDialog } from "@/components/install/install-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import {
  getCollectionsDailyReportColumns,
  COLLECTIONS_EXPORT_COLUMNS,
} from "@/components/collections/collections-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { DispatchApprovalQueue } from "@/components/dashboard/dispatch-approval-queue"
import {
  getInventoryListColumns,
  getInventoryListExpandedColumns,
  INVENTORY_LIST_EXPORT_COLUMNS,
} from "@/components/inventory/inventory-list-columns"
import { useFilterChangePlans, useDeleteFilterChangePlans, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans, useDeleteInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useRepairPlans, useDeleteRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCollections, useDeleteCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useStockMovementRows } from "@/lib/hooks/use-inventory"
import { useMyDailyReportLayout, useSaveMyDailyReportLayout } from "@/lib/hooks/use-daily-report-layout"
import { useDailyReportSections } from "@/lib/hooks/use-daily-report-sections"
import { resolveSectionConfigs, DEFAULT_SECTION_LABELS } from "@/lib/daily-report-sections-config"
import { useAuth } from "@/lib/auth/auth-context"
import { useReportDetailPanelOpen } from "@/lib/sidebar-collapse-context"
import { todayIso } from "@/lib/utils"
import type { DailyReportSectionKey, DispatchStatus, PanelSize } from "@/lib/types"

// Every panel this section can render. "date" and "inventory" aren't among
// the six admin-configurable sections (see daily_report_sections) — the
// other six map 1:1 to a section_key (see SECTION_KEY_TO_PANEL_ID) and can
// be enabled/disabled/renamed/reordered from Settings > Daily Report
// Sections, which every role (including a technician) reads to decide what
// to render. "inventory" (a read-only history view over stock_movements —
// see getInventoryListColumns) is additionally admin-only outright, not
// just unconfigurable — a technician can't read stock_movements at all
// (see the technician_role migration), so it's excluded entirely in the
// `order` computation below rather than rendering an always-empty panel.
type PanelId =
  | "date"
  | "schedule"
  | "announcements"
  | "installation"
  | "filter-change"
  | "collection"
  | "repair"
  | "inventory"

const SECTION_KEY_TO_PANEL_ID: Record<DailyReportSectionKey, PanelId> = {
  schedule: "schedule",
  announcements: "announcements",
  installation: "installation",
  filter_change: "filter-change",
  collection: "collection",
  repair: "repair",
}

// Only affects a panel's width until an admin drags it to a different size
// (see SortablePanel: this is a fallback class, overridden the instant a
// saved/live pixel width exists) — this is just what makes the *default*,
// never-yet-customized Stacked dashboard already show Installation/Filter
// Change and Collection/Repair as side-by-side pairs instead of every panel
// starting full-width and needing a manual resize first.
const HALF_WIDTH_PANELS = new Set<PanelId>(["installation", "filter-change", "collection", "repair", "inventory"])

// Same idea, for Grid mode's own default — its starting arrangement is a
// fixed 3-across layout (Announcements alone full-width, then Date/Repair/
// Schedule, then Installation/Filter Change/Collection), so every panel
// except Announcements starts at ~33% width. "inventory" isn't part of the
// fixed 3-across arrangement (it's new, admin-only, and appended at the end
// — see DEFAULT_GRID_ORDER) but still gets the same half-width default
// outside Grid's own fixed rows, via HALF_WIDTH_PANELS above.
const GRID_THREE_ACROSS_PANELS = new Set<PanelId>(["date", "repair", "schedule", "installation", "filter-change", "collection"])

// Grid mode's fixed starting order — distinct from Stacked's (which follows
// the admin's configured section order from Settings > Daily Report
// Sections, see basePanelOrder below). This one is hardcoded to match the
// old AppSheet Daily Report layout, and is only ever the *default*: once an
// admin drags/resizes anything in Grid mode, that saved layout (shared with
// Stacked — see the order/sizes computation below) takes over from here,
// same as Stacked already works.
const DEFAULT_GRID_ORDER: PanelId[] = [
  "announcements",
  "date",
  "repair",
  "schedule",
  "installation",
  "filter-change",
  "collection",
  "inventory",
]

function defaultWidthClassName(id: PanelId, isGrid: boolean): string {
  if (isGrid) {
    return GRID_THREE_ACROSS_PANELS.has(id) ? "w-full md:w-[calc(33.333%-16px)]" : "w-full"
  }
  // Date only ever holds one small input — it doesn't need to stretch full
  // width or pair 50/50 with anything, just enough room for its own content.
  if (id === "date") return "w-full sm:w-80"
  return HALF_WIDTH_PANELS.has(id) ? "w-full md:w-[calc(50%-12px)]" : "w-full"
}

// Gates every Daily Report day-filter below (see the
// dispatch_confirmation_workflow migration): a still-Draft item hasn't
// been admin-approved yet, one that's Pending Customer Confirmation is
// waiting on the customer's own response, and one the customer pushed
// back on (Reschedule Requested) needs the admin to re-approve with a new
// date — none of those three belong on the active daily dispatch list.
// Only 'Confirmed' does. undefined also passes as a rollout safety net: if
// this ships before the migration backfilling the column has actually run,
// every row's dispatchStatus reads as undefined, and gating strictly on
// === 'Confirmed' would blank out the whole Daily Report until someone
// noticed. Once the migration has run, every pre-existing row (and
// everything the recurring-schedule/C/T-completion generators still
// create) defaults straight to 'Confirmed' at the database layer, so this
// never actually excludes anything except a genuinely new, not-yet-
// resolved record.
function isDailyReportEligible(status: DispatchStatus | undefined): boolean {
  return status === undefined || status === "Confirmed"
}

function resolveOrder(saved: string[] | undefined, basePanelOrder: PanelId[]): PanelId[] {
  const known = new Set<string>(basePanelOrder)
  const savedValid = (saved ?? []).filter((id): id is PanelId => known.has(id))
  const missing = basePanelOrder.filter((id) => !savedValid.includes(id))
  return [...savedValid, ...missing]
}

// Drops any column whose key isn't in an admin's configured visibleFields
// for that section — empty visibleFields means "show all" (unedited/default
// state), same convention used everywhere else this list is read. An
// `accessorKey`-less column (e.g. the Mark Filter Changed/Record Payment
// quick-action columns) is a utility column, not a real data field a
// visibleFields checklist could ever have referred to — always kept,
// regardless of what's configured, same as the always-shown checkbox/
// delete columns elsewhere in this app.
function filterColumnsByVisibility<T>(columns: ColumnDef<T, unknown>[], visibleFields: string[]): ColumnDef<T, unknown>[] {
  if (visibleFields.length === 0) return columns
  return columns.filter((col) => !("accessorKey" in col) || visibleFields.includes(String(col.accessorKey)))
}

// Two layout modes, both fully draggable/resizable per-admin (see
// use-daily-report-layout.ts) — they differ only in their *default*
// starting order/widths, used until an admin has customized anything at
// all. "stacked" starts at the admin-configured section order/labels (see
// daily_report_sections, read via useDailyReportSections below) with
// Installation/Filter Change/Collection/Repair paired up by default (see
// HALF_WIDTH_PANELS). "grid" starts at the fixed old-AppSheet 3-across
// layout instead (DEFAULT_GRID_ORDER/GRID_THREE_ACROSS_PANELS). Once an
// admin drags or resizes anything, in either mode, that single saved
// layout (shared between the two modes — see order/sizes below) takes over
// as the starting point from then on, regardless of which mode is active.
// A disabled section never renders for anyone, technicians included,
// regardless of mode or saved layout — see isPanelEnabled. Rendered on both
// the Dashboard and the standalone Daily Report page so they stay in sync
// rather than drifting as two separate copies.
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

  // The admin-authored section configuration — a single SHARED table, not
  // per-admin: every viewer (technician included) fetches this to know
  // which sections are enabled, their order, and their labels. Always fully
  // resolved to all six keys (resolveSectionConfigs fills in defaults for
  // any missing row), so there's no loading-flicker to guard against.
  const { data: sectionRows } = useDailyReportSections()
  const sections = React.useMemo(() => resolveSectionConfigs(sectionRows ?? []), [sectionRows])
  const sectionByPanelId = React.useMemo(() => {
    const map = new Map<PanelId, (typeof sections)[number]>()
    for (const s of sections) map.set(SECTION_KEY_TO_PANEL_ID[s.sectionKey], s)
    return map
  }, [sections])
  const isPanelEnabled = React.useCallback(
    (id: PanelId) => {
      // Read-only stock_movements history — a technician can't read that
      // table at all (see the technician_role migration), so this is
      // excluded outright rather than rendering a panel that would only
      // ever show "no movements" for that role.
      if (id === "inventory") return isAdmin
      return id === "date" || sectionByPanelId.get(id)?.enabled !== false
    },
    [sectionByPanelId, isAdmin]
  )
  // The base order (before any admin's personal drag-reorder in Stacked
  // mode, and always in Grid mode) — Date pinned first, then the configured
  // sections in their admin-set displayOrder, then Inventory List last (new,
  // admin-only, not part of the configurable-section system — see
  // isPanelEnabled above).
  const basePanelOrder = React.useMemo<PanelId[]>(
    () => ["date", ...sections.map((s) => SECTION_KEY_TO_PANEL_ID[s.sectionKey]), "inventory"],
    [sections]
  )
  const labelFor = React.useCallback(
    (key: DailyReportSectionKey) => sections.find((s) => s.sectionKey === key)?.label ?? DEFAULT_SECTION_LABELS[key],
    [sections]
  )
  const visibleFieldsFor = React.useCallback(
    (key: DailyReportSectionKey) => sections.find((s) => s.sectionKey === key)?.visibleFields ?? [],
    [sections]
  )

  // A technician never fetches or saves a layout at all (the query is
  // disabled below) — they always render the hardcoded stacked default
  // order/sizes.
  const { data: myLayout } = useMyDailyReportLayout(isAdmin ? user?.id : undefined)
  const saveLayout = useSaveMyDailyReportLayout(user?.id)

  // Same saved-layout pattern as order/sizes below. The mode toggle itself
  // is still per-admin — only the arrangement *within* Grid mode is fixed.
  const savedLayoutMode = myLayout?.layoutMode ?? "stacked"
  const [localLayoutMode, setLocalLayoutMode] = React.useState<"stacked" | "grid" | null>(null)
  const layoutMode = localLayoutMode ?? savedLayoutMode

  function handleLayoutModeChange(mode: "stacked" | "grid") {
    if (mode === layoutMode) return
    setLocalLayoutMode(mode)
    saveLayout.mutate({ layoutMode: mode })
  }

  const isGrid = layoutMode === "grid"
  const canArrange = isAdmin

  // The saved order, derived straight from the fetched layout — no effect
  // needed. A local override holds the just-dropped order for immediate
  // feedback until the mutation round-trips and the layout refetches to
  // match. One saved layout shared by both modes: resolveOrder falls back to
  // the mode-specific default (DEFAULT_GRID_ORDER vs. basePanelOrder) only
  // for entries not already in the saved order — which is everything, for
  // an admin who's never customized anything, and nothing once they have.
  const savedOrder = React.useMemo(
    () => resolveOrder(myLayout?.layout, isGrid ? DEFAULT_GRID_ORDER : basePanelOrder),
    [myLayout, isGrid, basePanelOrder]
  )
  const [localOrder, setLocalOrder] = React.useState<PanelId[] | null>(null)
  const unfilteredOrder = localOrder ?? savedOrder
  // Disabled sections are dropped last, after either ordering rule above —
  // this is what makes a disabled section disappear for every role, not
  // just get skipped in one mode.
  const order = React.useMemo(() => unfilteredOrder.filter(isPanelEnabled), [unfilteredOrder, isPanelEnabled])

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
  // feedback until the layout refetches to match. Shared by both modes, same
  // reasoning as order above.
  const savedSizes = myLayout?.panelSizes ?? {}
  const [localSizes, setLocalSizes] = React.useState<Record<string, PanelSize>>({})
  const sizes = { ...savedSizes, ...localSizes }

  function handleResizeEnd(panelId: string, size: PanelSize) {
    setLocalSizes((prev) => ({ ...prev, [panelId]: size }))
    saveLayout.mutate({ panelSizes: { ...sizes, [panelId]: size } })
  }

  const [reportDate, setReportDate] = React.useState(todayIso)

  const { data: filterChangePlans = [], isPending: pFilter } = useFilterChangePlans()
  const { data: installPlans = [], isPending: pInstall } = useInstallPlans()
  const { data: repairPlans = [], isPending: pRepair } = useRepairPlans()
  const { data: collectionPlans = [], isPending: pCollections } = useCollections()
  // RLS returns this empty for a technician (stock_movements is admin-only
  // — see the technician_role migration) rather than erroring, so this is
  // safe to call unconditionally; the panel itself is hidden for that role
  // regardless (see isPanelEnabled above).
  const { data: stockMovements = [], isPending: pInventory } = useStockMovementRows()

  // Admin-only Pending Dispatch Approval queue (see the
  // dispatch_confirmation_workflow migration) — counts every Draft item
  // across all four modules so the header button can show how many are
  // waiting without opening the dialog first.
  const [dispatchQueueOpen, setDispatchQueueOpen] = React.useState(false)
  const draftDispatchCount = React.useMemo(() => {
    return (
      filterChangePlans.filter((p) => p.dispatchStatus === "Draft").length +
      installPlans.filter((p) => p.dispatchStatus === "Draft").length +
      repairPlans.filter((p) => p.dispatchStatus === "Draft").length +
      collectionPlans.filter((p) => p.dispatchStatus === "Draft").length
    )
  }, [filterChangePlans, installPlans, repairPlans, collectionPlans])

  const deleteFilterChangePlans = useDeleteFilterChangePlans()
  const deleteInstallPlans = useDeleteInstallPlans()
  const deleteRepairPlans = useDeleteRepairPlans()
  const deleteCollections = useDeleteCollections()
  // Inline Status dropdown (Pending/Completed/Cancelled, or Pending/
  // Collected/Cancelled for Collections) — a plain status update on the
  // same record the full Filter Change/Install/Collection/Repair pages
  // already edit, so the report and those pages can never drift: all four
  // read from the same useFilterChangePlans()/useInstallPlans()/
  // useCollections()/useRepairPlans() query, and each mutation's onSuccess
  // (see the hooks themselves) invalidates that exact query, which is what
  // makes the report's own day-filtered rows — and the standalone list
  // pages, reading the same query — update immediately without a manual
  // refetch.
  const updateFilterChangePlan = useUpdateFilterChangePlan()
  const updateInstallPlan = useUpdateInstallPlan()
  const updateRepairPlan = useUpdateRepairPlan()
  const updateCollection = useUpdateCollection()

  const [filterChangeFormOpen, setFilterChangeFormOpen] = React.useState(false)
  const [installFormOpen, setInstallFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)
  const [collectionsFormOpen, setCollectionsFormOpen] = React.useState(false)

  // Each section's column set, trimmed to the admin's configured Visible
  // Fields (see Settings > Daily Report Sections > Edit Section) — empty
  // means unedited/show-all, so this is a no-op until an admin actually
  // unchecks something.
  const filterChangeColumns = React.useMemo(
    () =>
      filterColumnsByVisibility(
        getFilterChangeDailyReportColumns({
          onStatusChange: isAdmin ? (plan, status) => updateFilterChangePlan.mutate({ id: plan.id, input: { status } }) : undefined,
          // Pre D/Serviceman/Note edited straight from the panel cell (see
          // getFilterChangeDailyReportColumns) — same mutate-and-invalidate
          // hook the status column above already uses, so the panel's own
          // day-filtered rows update immediately without a manual refetch.
          onFieldChange: isAdmin ? (plan, patch) => updateFilterChangePlan.mutate({ id: plan.id, input: patch }) : undefined,
        }),
        visibleFieldsFor("filter_change")
      ),
    [visibleFieldsFor, isAdmin, updateFilterChangePlan]
  )
  const filterChangeExpandedColumns = React.useMemo(
    () => filterColumnsByVisibility(getFilterChangeExpandedColumns(), visibleFieldsFor("filter_change")),
    [visibleFieldsFor]
  )
  const installColumns = React.useMemo(
    () =>
      filterColumnsByVisibility(
        getInstallColumns({
          onStatusChange: isAdmin ? (plan, status) => updateInstallPlan.mutate({ id: plan.id, input: { status } }) : undefined,
        }),
        visibleFieldsFor("installation")
      ),
    [visibleFieldsFor, isAdmin, updateInstallPlan]
  )
  const repairColumns = React.useMemo(
    () =>
      filterColumnsByVisibility(
        getRepairColumns({
          onStatusChange: isAdmin ? (plan, status) => updateRepairPlan.mutate({ id: plan.id, input: { status } }) : undefined,
        }),
        visibleFieldsFor("repair")
      ),
    [visibleFieldsFor, isAdmin, updateRepairPlan]
  )
  const collectionsColumns = React.useMemo(
    () =>
      filterColumnsByVisibility(
        getCollectionsDailyReportColumns({
          onStatusChange: isAdmin ? (entry, status) => updateCollection.mutate({ id: entry.id, input: { status } }) : undefined,
          // Pre D/Amount/Note edited straight from the panel cell (see
          // getCollectionsDailyReportColumns) — same mutate-and-invalidate
          // hook the status column above already uses.
          onFieldChange: isAdmin ? (entry, patch) => updateCollection.mutate({ id: entry.id, input: patch }) : undefined,
        }),
        visibleFieldsFor("collection")
      ),
    [visibleFieldsFor, isAdmin, updateCollection]
  )
  // Not one of the six admin-configurable sections (see the PanelId comment
  // above), so no visibleFieldsFor entry exists for it — always the full
  // compact/expanded set as defined in inventory-list-columns.tsx.
  const inventoryListColumns = React.useMemo(() => getInventoryListColumns(), [])
  const inventoryListExpandedColumns = React.useMemo(() => getInventoryListExpandedColumns(), [])

  // Pre D, when set, is the record's actual (re)scheduled date — it wins
  // over each module's own base date field for deciding which day's Daily
  // Report it belongs on, matching COALESCE(pre_d, plan_d) semantics: an
  // admin who reschedules something via Pre D expects it to move to *that*
  // day's report, not stay stuck under its original date. Falls back to the
  // base field whenever Pre D is empty (the common case), so nothing
  // already-unset changes behavior. All four modules (Filter Change,
  // Installation, Collection, Repair) get this same treatment.
  //
  // isDailyReportEligible() also gates every one of these — see its own
  // comment for why (dispatch_confirmation_workflow migration).
  const dayFilterChangePlans = React.useMemo(
    () => filterChangePlans.filter((p) => (p.preD || p.planDate) === reportDate && isDailyReportEligible(p.dispatchStatus)),
    [filterChangePlans, reportDate]
  )
  // InstallPlan has no preD field — its own equivalent "rescheduled date"
  // is preInstalledDate (input date is the plan/entry date, installedDate
  // is when it actually happened — see the InstallPlan type), so that's
  // what wins over inputDate here, same COALESCE semantics as the others.
  const dayInstallPlans = React.useMemo(
    () => installPlans.filter((p) => (p.preInstalledDate || p.inputDate) === reportDate && isDailyReportEligible(p.dispatchStatus)),
    [installPlans, reportDate]
  )
  const dayRepairPlans = React.useMemo(
    () => repairPlans.filter((p) => (p.preD || p.issuedDate) === reportDate && isDailyReportEligible(p.dispatchStatus)),
    [repairPlans, reportDate]
  )
  const dayCollectionPlans = React.useMemo(
    () => collectionPlans.filter((p) => (p.preD || p.collectionDate) === reportDate && isDailyReportEligible(p.dispatchStatus)),
    [collectionPlans, reportDate]
  )
  // Filtered by the movement's own `date` (its as-of day — defaults to the
  // day it was recorded, and matches the completed job's scheduledDate for
  // the filter-change deduction path), same convention as every other
  // section here filtering by its own date field. History only — this
  // never approves/edits/creates anything; see getInventoryListColumns.
  const dayStockMovements = React.useMemo(
    () => stockMovements.filter((m) => m.date === reportDate),
    [stockMovements, reportDate]
  )

  // Raw panel content, unwrapped — always wrapped in SortablePanel +
  // ResizablePanel below (see resizable()). Titles come from the admin's
  // configured label (labelFor), not a hardcoded string, for every section
  // except Date, which isn't one.
  const rawContent: Record<PanelId, React.ReactNode> = {
    announcements: <AnnouncementPanel title={labelFor("announcements")} />,
    schedule: <ScheduleAgenda date={reportDate} title={labelFor("schedule")} />,
    date: <DateControl value={reportDate} onChange={setReportDate} />,
    "filter-change": (
      <DashboardPlanPanel
        title={labelFor("filter_change")}
        icon={Droplets}
        columns={filterChangeColumns}
        expandedColumns={filterChangeExpandedColumns}
        data={dayFilterChangePlans}
        loading={pFilter}
        emptyMessage="No filter change plans for this date."
        canAdd={isAdmin}
        addLabel="Add"
        onAdd={() => setFilterChangeFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteFilterChangePlans.mutateAsync(ids)}
        exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
        exportFileName="filter-change-plan"
        onRowClick={isAdmin ? (row) => router.push(`/filter-change?id=${row.id}`) : undefined}
        panelHeight={sizes["filter-change"]?.height}
        tableContainerClassName="scrollbar-always-visible"
      />
    ),
    installation: (
      <DashboardPlanPanel
        title={labelFor("installation")}
        icon={HardHat}
        columns={installColumns}
        data={dayInstallPlans}
        loading={pInstall}
        emptyMessage="No installs for this date."
        canAdd={isAdmin}
        addLabel="Add"
        onAdd={() => setInstallFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteInstallPlans.mutateAsync(ids)}
        exportColumns={INSTALL_EXPORT_COLUMNS}
        exportFileName="install-plan"
        onRowClick={isAdmin ? (row) => router.push(`/install?id=${row.id}`) : undefined}
        panelHeight={sizes.installation?.height}
      />
    ),
    repair: (
      <DashboardPlanPanel
        title={labelFor("repair")}
        icon={Wrench}
        columns={repairColumns}
        data={dayRepairPlans}
        loading={pRepair}
        emptyMessage="No repair plans for this date."
        canAdd={isAdmin}
        addLabel="Add"
        onAdd={() => setRepairFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteRepairPlans.mutateAsync(ids)}
        exportColumns={REPAIR_EXPORT_COLUMNS}
        exportFileName="repair-plan"
        onRowClick={isAdmin ? (row) => router.push(`/repair-plan?id=${row.id}`) : undefined}
        panelHeight={sizes.repair?.height}
      />
    ),
    collection: (
      <DashboardPlanPanel
        title={labelFor("collection")}
        icon={Banknote}
        columns={collectionsColumns}
        data={dayCollectionPlans}
        loading={pCollections}
        emptyMessage="No collections for this date."
        canAdd={isAdmin}
        addLabel="Add"
        onAdd={() => setCollectionsFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteCollections.mutateAsync(ids)}
        exportColumns={COLLECTIONS_EXPORT_COLUMNS}
        exportFileName="collection-plan"
        onRowClick={isAdmin ? (row) => router.push(`/collection-plan?id=${row.id}`) : undefined}
        panelHeight={sizes.collection?.height}
        tableContainerClassName="scrollbar-always-visible"
      />
    ),
    // Read-only — no canAdd/onAdd/canDelete/onDeleteSelected, deliberately:
    // this panel only ever displays the existing stock_movements ledger, it
    // never creates, edits, or approves anything itself. Approving a
    // pending movement stays exactly where it already was, on Inventory >
    // In & Out — clicking through there is a convenience, not a shortcut
    // around that page's own admin-only approve action.
    inventory: (
      <DashboardPlanPanel
        title="Inventory List"
        icon={Package}
        columns={inventoryListColumns}
        expandedColumns={inventoryListExpandedColumns}
        data={dayStockMovements}
        loading={pInventory}
        emptyMessage="No inventory movements for this date."
        exportColumns={INVENTORY_LIST_EXPORT_COLUMNS}
        exportFileName="inventory-list"
        onRowClick={() => router.push("/inventory/in-and-out")}
        panelHeight={sizes.inventory?.height}
      />
    ),
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
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
          <Button
            type="button"
            size="sm"
            variant={draftDispatchCount > 0 ? "default" : "outline"}
            className="gap-1.5 ml-auto"
            onClick={() => setDispatchQueueOpen(true)}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Pending Dispatch Approval{draftDispatchCount > 0 ? ` (${draftDispatchCount})` : ""}
          </Button>
          <DispatchApprovalQueue open={dispatchQueueOpen} onOpenChange={setDispatchQueueOpen} />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {/* flex-wrap in both modes: every panel's default width comes from
              defaultWidthClassName (mode-specific — see GRID_THREE_ACROSS_PANELS
              vs. HALF_WIDTH_PANELS), which is what pairs panels up into rows
              automatically before anything's been resized. In both modes an
              admin can drag either edge (width) or the bottom-right corner
              (width+height), and it'll sit beside its neighbor whenever the
              two fit, building a multi-column dashboard freely. */}
          <div className="flex flex-wrap items-start gap-6">
            {order.map((id) => (
              <SortablePanel
                key={id}
                id={id}
                isAdmin={canArrange}
                width={sizes[id]?.width}
                height={sizes[id]?.height}
                defaultWidthClassName={defaultWidthClassName(id, isGrid)}
                onResizeEnd={(size) => handleResizeEnd(id, size)}
              >
                {rawContent[id]}
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
