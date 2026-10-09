"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { businessToday } from "@/lib/dispatch-lead-time"
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
import { Droplets, HardHat, Wrench, Banknote, Rows3, LayoutGrid, Package, PackageCheck, ClipboardCheck, CheckCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnnouncementPanel } from "@/components/announcements/announcement-panel"
import { DailyReportDateButton } from "@/components/dashboard/daily-report-date-button"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import { SortablePanel } from "@/components/dashboard/sortable-panel"
import { StatusBadge } from "@/components/shared/status-badge"
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda"
import {
  getFilterChangeDailyReportExpandedColumns,
  FILTER_CHANGE_EXPORT_COLUMNS,
  type FilterChangeDailyReportPatch,
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
import { DispatchApprovalQueue, useDispatchApprovalCount } from "@/components/dashboard/dispatch-approval-queue"
import { AllCollectionDialog } from "@/components/dashboard/all-collection-dialog"
import { StockMovementApprovalQueue } from "@/components/dashboard/stock-movement-approval-queue"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import {
  getInventoryListExpandedColumns,
  inventoryListDensityForWidth,
  groupInventoryListRows,
  aggregateInventoryRowsByItem,
  INVENTORY_LIST_EXPORT_COLUMNS,
} from "@/components/inventory/inventory-list-columns"
import { StockMovementFormDialog } from "@/components/inventory/stock-movement-form-dialog"
import { DailyReportExportMenu } from "@/components/dashboard/daily-report-export-menu"
import { useFilterChangePlans, useDeleteFilterChangePlans, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans, useDeleteInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useRepairPlans, useDeleteRepairPlans, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCollections, useDeleteCollections, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useApproveStockMovements, useRejectStockMovements, useStockMovementRows, type StockMovementRow } from "@/lib/hooks/use-inventory"
import { useMyDailyReportLayout, useSaveMyDailyReportLayout } from "@/lib/hooks/use-daily-report-layout"
import { useDailyReportSections } from "@/lib/hooks/use-daily-report-sections"
import { resolveSectionConfigs, DEFAULT_SECTION_LABELS } from "@/lib/daily-report-sections-config"
import { useAuth } from "@/lib/auth/auth-context"
import { useReportDetailPanelOpen } from "@/lib/sidebar-collapse-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { DailyReportSectionKey, DispatchFields, DispatchStatus, FilterChangePlan, PanelSize } from "@/lib/types"
import { completionDateFor } from "@/lib/completion-date"

// Every panel this section can render. "date" used to be one of these (a
// full draggable/resizable card) — it's now a compact button in the toolbar
// instead (see DailyReportDateButton), not a panel at all, freeing that
// dashboard space. "inventory" isn't among the six admin-configurable
// sections (see daily_report_sections) — the other six map 1:1 to a
// section_key (see SECTION_KEY_TO_PANEL_ID) and can be enabled/disabled/
// renamed/reordered from Settings > Daily Report Sections, which every role
// (including a technician) reads to decide what to render. "inventory" (a
// read-only history view over stock_movements — see
// getInventoryListExpandedColumns) is additionally admin-only outright, not just
// unconfigurable — a technician can't read stock_movements at all (see the
// technician_role migration), so it's excluded entirely in the `order`
// computation below rather than rendering an always-empty panel.
type PanelId =
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
// fixed 2x3 grid (Announcement/Schedule/Repair, then Inventory List/Filter
// Change/Installation), each at ~33% width, with Collection full-width alone
// on its own row after — matching the admin's most recent explicit layout
// request, superseding the earlier "old AppSheet screenshot" arrangement.
const GRID_THREE_ACROSS_PANELS = new Set<PanelId>([
  "announcements",
  "schedule",
  "repair",
  "inventory",
  "filter-change",
  "installation",
])

// Grid mode's fixed starting order — distinct from Stacked's (which follows
// the admin's configured section order from Settings > Daily Report
// Sections, see basePanelOrder below). This one is hardcoded to the admin's
// requested arrangement, and is only ever the *default*: once an admin
// drags/resizes anything in Grid mode, that saved layout (shared with
// Stacked — see the order/sizes computation below) takes over from here,
// same as Stacked already works.
const DEFAULT_GRID_ORDER: PanelId[] = [
  "announcements",
  "schedule",
  "repair",
  "inventory",
  "filter-change",
  "installation",
  "collection",
]

function defaultWidthClassName(id: PanelId, isGrid: boolean, isAdmin: boolean): string {
  // A technician only ever has Announcements + Schedule left to render (see
  // isPanelEnabled) — the admin's own grid sizing below (~33% each, tuned
  // for a 6-panel dashboard) would leave roughly a third of every row empty
  // once the other four are hidden. Side-by-side halves fill the row
  // naturally instead — same calc(50%-12px) convention Stacked mode's own
  // HALF_WIDTH_PANELS already uses, just applied regardless of layout mode
  // here since a technician is always on Grid (see canArrange) and has no
  // saved layout of their own to override it.
  if (!isAdmin) return "w-full md:w-[calc(50%-12px)]"
  if (isGrid) {
    // "collection" is deliberately not in GRID_THREE_ACROSS_PANELS — it
    // falls through to full-width here, same as "inventory" used to before
    // this arrangement (see that set's own comment).
    return GRID_THREE_ACROSS_PANELS.has(id) ? "w-full md:w-[calc(33.333%-16px)]" : "w-full"
  }
  return HALF_WIDTH_PANELS.has(id) ? "w-full md:w-[calc(50%-12px)]" : "w-full"
}

// Gates every Daily Report day-filter below. Reverts an earlier "show
// Draft/Pending Customer Confirmation too" relaxation back to strictly
// 'Confirmed' — now that CP-cycle-generated filter-change/collection
// occurrences require a real once-per-order approval (see the
// 20260912000000_first_occurrence_requires_approval migration), a Draft or
// Pending Customer Confirmation row reaching this far means real
// customer-facing approval work is still outstanding, not something a
// technician should already be executing today. The Daily Report is meant
// to be a clean "what's actually locked in and needs doing" view, not a
// place to surface in-flight approvals — those belong in the dedicated
// Pending Approval Queue / Pending Approvals panel instead. undefined still
// passes as a rollout safety net for any row somehow missing the column.
function isDailyReportEligible(status: DispatchStatus | undefined): boolean {
  return status === "Confirmed" || status === undefined
}

// Renders nothing for a 'Confirmed' (or legacy-undefined) row — those are
// the ones actually locked in for the day and don't need calling out. A
// Draft/Pending Customer Confirmation row gets an explicit badge so it
// can't be mistaken for confirmed just because it's sitting on the same
// day's list now (see isDailyReportEligible's own comment for why they're
// on this list at all).
const DISPATCH_STATUS_KEYS: Record<string, string> = {
  Draft: "draft",
  "Pending Customer Confirmation": "pendingCustomerConfirmation",
  Confirmed: "confirmed",
  "Reschedule Requested": "rescheduleRequested",
}

function DispatchStatusCell({ status }: { status: DispatchStatus | undefined }) {
  const { t } = useTranslation("dispatch")
  if (!status || status === "Confirmed") return null
  const tone = status === "Draft" ? "neutral" : "warning"
  return <StatusBadge tone={tone} label={t(DISPATCH_STATUS_KEYS[status] ?? status)} />
}

// Prepends a purely-visual, accessorKey-less "Dispatch" indicator column
// ahead of whatever field columns a module's own column-def function
// returns — added here, at the Daily Report call site, rather than inside
// getFilterChangeDailyReportColumns/getInstallColumns/getCollectionsDailyReportColumns/
// getRepairColumns themselves, since those are shared with other pages
// (Sale List, Member detail, the customer portal scan view, the standalone
// module pages) that have no reason to show a dispatch-approval badge at
// all. Same "utility column bolted on at the panel, not the shared
// definition" shape as DashboardPlanPanel's own select-mode checkbox
// column.
function withDispatchStatusColumn<T extends DispatchFields>(columns: ColumnDef<T, unknown>[]): ColumnDef<T, unknown>[] {
  const statusColumn: ColumnDef<T, unknown> = {
    id: "__dispatchStatus",
    header: "",
    cell: ({ row }) => <DispatchStatusCell status={row.original.dispatchStatus} />,
  }
  return [statusColumn, ...columns]
}

// Row-level tint, applied on top of the badge column above — the two
// together are what make a not-yet-locked-in row genuinely hard to miss
// rather than relying on a single small badge easy to skim past.
function dispatchRowClassName(status: DispatchStatus | undefined): string | undefined {
  if (status === "Draft") return "bg-muted/40"
  if (status === "Pending Customer Confirmation") return "bg-warning/5"
  return undefined
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
// A ?date= value the Daily Report accepts: YYYY-MM-DD and a real calendar
// date (2026-02-30 is not). Anything else falls back to today.
function validReportDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : undefined
}

export function DailyReportSection() {
  const router = useRouter()
  const { user, can } = useAuth()
  const isAdmin = user?.role === "admin"
  const { t: tFilterChange } = useTranslation("filterChange")
  const { t: tInstall } = useTranslation("install")
  const { t: tRepair } = useTranslation("repair")
  const { t: tCollection } = useTranslation("collection")
  const { t: tInventory } = useTranslation("inventory")
  const { t: tDispatch } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { t: tAllCollection } = useTranslation("allCollection")

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
      // A technician's Daily Report is their own personal work-day view,
      // not an admin-level operations dashboard — only their own Schedule
      // (see ScheduleAgenda's own technicianUserId/technician2UserId
      // filter) and Announcements ever render for that role. This is a
      // hard role restriction, checked before — and regardless of — the
      // admin's own Daily Report Sections enable/disable configuration
      // below, which stays purely an admin-facing customization of what
      // *admins* see; a technician was never meant to be grantable access
      // to Filter Change/Install/Repair/Collection via that toggle.
      if (!isAdmin && id !== "schedule" && id !== "announcements") return false
      return sectionByPanelId.get(id)?.enabled !== false
    },
    [sectionByPanelId, isAdmin]
  )
  // The base order (before any admin's personal drag-reorder in Stacked
  // mode, and always in Grid mode) — the configured sections in their
  // admin-set displayOrder, then Inventory List last (new, admin-only, not
  // part of the configurable-section system — see isPanelEnabled above).
  const basePanelOrder = React.useMemo<PanelId[]>(
    () => [...sections.map((s) => SECTION_KEY_TO_PANEL_ID[s.sectionKey]), "inventory"],
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
  // disabled below) — they always render the hardcoded grid default
  // order/sizes.
  // Every user's own layout (sizes, order, mode) — RLS scopes the row to
  // them; technicians resize their panels too, only admins reorder.
  const { data: myLayout } = useMyDailyReportLayout(user?.id)
  const saveLayout = useSaveMyDailyReportLayout(user?.id)

  // Same saved-layout pattern as order/sizes below. The mode toggle itself
  // is still per-admin — only the arrangement *within* Grid mode is fixed.
  // "grid" (the AppSheet-matching arrangement, see DEFAULT_GRID_ORDER) is
  // the fallback so a never-customized admin — and every technician, who
  // can never toggle this at all (see canArrange) — lands there directly,
  // not on Stacked.
  const savedLayoutMode = myLayout?.layoutMode ?? "grid"
  const [localLayoutMode, setLocalLayoutMode] = React.useState<"stacked" | "grid" | null>(null)
  const layoutMode = localLayoutMode ?? savedLayoutMode

  function handleLayoutModeChange(mode: "stacked" | "grid") {
    if (mode === layoutMode) return
    setLocalLayoutMode(mode)
    saveLayout.mutate({ layoutMode: mode })
  }

  const isGrid = layoutMode === "grid"
  // A user's first save (a resize or reorder) creates their layout row, whose
  // layout_mode column defaults to 'stacked' in the database — while the
  // page shows grid until a row exists. Saving the mode they're looking at
  // along with it keeps that first change from flipping the whole report to
  // stacked (and re-ordering every panel).
  const firstSaveMode = myLayout ? {} : { layoutMode }
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
    saveLayout.mutate({ layout: next, ...firstSaveMode })
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
    saveLayout.mutate({ panelSizes: { ...sizes, [panelId]: size }, ...firstSaveMode })
  }

  // The report date lives in the address (?date=YYYY-MM-DD) so a refresh or a
  // shared link keeps it. No (or an invalid) date means today in Manila — so
  // opening the Daily Report from the menu (plain "/") starts at today. A new
  // date replaces the address instead of adding a history entry per date.
  const searchParams = useSearchParams()
  const reportDate = validReportDate(searchParams.get("date")) ?? businessToday()
  const setReportDate = React.useCallback((next: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set("date", next)
    window.history.replaceState(null, "", `?${params.toString()}`)
  }, [])

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
  // dispatch_confirmation_workflow migration) — useDispatchApprovalCount
  // reads off the exact same row-building logic (useDispatchApprovalRows,
  // in dispatch-approval-queue.tsx) that the dialog's own items/
  // rescheduleRequests derive from, so this button's badge can never drift
  // from what the dialog actually shows once opened. Previously computed
  // as a second, independent Draft-only tally directly from the four plan
  // queries below — that silently undercounted the moment a Reschedule
  // Requested item existed (the dialog's own "Reschedule Requests" section
  // counts those too, this badge didn't).
  const [dispatchQueueOpen, setDispatchQueueOpen] = React.useState(false)
  const dispatchApprovalCount = useDispatchApprovalCount()

  // The stock movement review queue (StockMovementApprovalQueue) — opened
  // from the Inventory List panel (Review, or a row's Map item), which is
  // where pending inventory items are approved now; there's no separate
  // header button for it.
  const [inventoryQueueOpen, setInventoryQueueOpen] = React.useState(false)

  // All Collection — the cross-module payments view (see
  // all-collection-dialog.tsx). No count badge: unlike the three queues
  // above, this isn't an approval backlog to clear, it's a browsable ledger
  // that always shows every record regardless of collected status.
  const [allCollectionOpen, setAllCollectionOpen] = React.useState(false)

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
  // Same +Add pairing as the four states above, for the Inventory List
  // panel's own +Add button.
  const [inventoryFormOpen, setInventoryFormOpen] = React.useState(false)
  // The record an Edit button on the Inventory List panel opened, if any —
  // same editing + form-open pairing every other panel's own Edit pencil
  // already uses (see member-order-detail.tsx's withEditColumn). Combined
  // with inventoryFormOpen on the single StockMovementFormDialog instance
  // below (open={inventoryFormOpen || !!editingStockMovement}) exactly the
  // way member-order-detail.tsx already combines its own formOpen/editing
  // pair for a shared Add-or-Edit dialog — movement stays undefined for the
  // +Add case, putting the dialog in create mode.
  const [editingStockMovement, setEditingStockMovement] = React.useState<StockMovementRow | undefined>(undefined)

  // Each section's column set, trimmed to the admin's configured Visible
  // Fields (see Settings > Daily Report Sections > Edit Section) — empty
  // means unedited/show-all, so this is a no-op until an admin actually
  // unchecks something.
  // Deliberately NOT run through filterColumnsByVisibility, unlike every
  // other section's compact column memo below — an admin's saved Visible
  // Fields selection for filter_change predates this panel's own column
  // set, so applying it here risks silently clipping columns that are now
  // always shown (see filterChangeColumns below — no compact/expanded
  // split left to protect).
  const filterChangeColumnParams = React.useMemo(
    () => ({
      onStatusChange: isAdmin
        ? (plan: FilterChangePlan, status: string) => {
            const accD = completionDateFor(status, plan.status, plan.accD)
            updateFilterChangePlan.mutate({ id: plan.id, input: { status, ...(accD !== undefined ? { accD } : {}) } })
          }
        : undefined,
      // Filter/Pre D/Acc D/Serviceman edited straight from the cell
      // (compact or expanded — both share the same cell renderers, see
      // dailyReportColumnDefs) — same mutate-and-invalidate hook the status
      // column already uses, so the panel's own day-filtered rows update
      // immediately without a manual refetch.
      onFieldChange: isAdmin
        ? (plan: FilterChangePlan, patch: FilterChangeDailyReportPatch) =>
            updateFilterChangePlan.mutate({ id: plan.id, input: patch })
        : undefined,
    }),
    [isAdmin, updateFilterChangePlan]
  )
  // The full 10-column set (getFilterChangeDailyReportExpandedColumns),
  // used for BOTH the compact panel and the Maximize2 dialog now — see the
  // "Enable Horizontal Scroll" change: an admin can scroll the compact
  // panel itself to see every column (Member Account#, Contact #, Address,
  // Serviceman, Status included) instead of needing the dialog just to see
  // data that's already loaded. getFilterChangeDailyReportColumns (the
  // narrower 5) is untouched and still used as-is by member-order-detail.tsx's
  // own embedded panel, which has its own, different reason to stay compact.
  const filterChangeColumns = React.useMemo(
    () => withDispatchStatusColumn(getFilterChangeDailyReportExpandedColumns(filterChangeColumnParams)),
    [filterChangeColumnParams]
  )
  const installColumns = React.useMemo(
    () =>
      withDispatchStatusColumn(
        filterColumnsByVisibility(
          getInstallColumns({
            onStatusChange: isAdmin
              ? (plan, status) => {
                  const installedDate = completionDateFor(status, plan.status, plan.installedDate)
                  updateInstallPlan.mutate({ id: plan.id, input: { status, ...(installedDate !== undefined ? { installedDate } : {}) } })
                }
              : undefined,
            onFieldChange: isAdmin ? (plan, patch) => updateInstallPlan.mutate({ id: plan.id, input: patch }) : undefined,
          }),
          visibleFieldsFor("installation")
        )
      ),
    [visibleFieldsFor, isAdmin, updateInstallPlan]
  )
  const repairColumns = React.useMemo(
    () =>
      withDispatchStatusColumn(
        filterColumnsByVisibility(
          getRepairColumns({
            onStatusChange: isAdmin
              ? (plan, status) => {
                  const accD = completionDateFor(status, plan.status, plan.accD)
                  updateRepairPlan.mutate({ id: plan.id, input: { status, ...(accD !== undefined ? { accD } : {}) } })
                }
              : undefined,
          }),
          visibleFieldsFor("repair")
        )
      ),
    [visibleFieldsFor, isAdmin, updateRepairPlan]
  )
  const collectionsColumns = React.useMemo(
    () =>
      withDispatchStatusColumn(
        filterColumnsByVisibility(
          getCollectionsDailyReportColumns({
            onStatusChange: isAdmin ? (entry, status) => updateCollection.mutate({ id: entry.id, input: { status } }) : undefined,
            // C/T/Pre D/Acc D/Amount/Note/Serviceman edited straight from
            // the panel cell (see getCollectionsDailyReportColumns) — same
            // mutate-and-invalidate hook the status column above already uses.
            onFieldChange: isAdmin ? (entry, patch) => updateCollection.mutate({ id: entry.id, input: patch }) : undefined,
          }),
          visibleFieldsFor("collection")
        )
      ),
    [visibleFieldsFor, isAdmin, updateCollection]
  )
  // Not one of the six admin-configurable sections (see the PanelId comment
  // above), so no visibleFieldsFor entry exists for it — always the full
  // set as defined in inventory-list-columns.tsx (getInventoryListColumns,
  // the narrower 5-column set, is no longer used by this panel — see the
  // inventory panel's own comment below). onEdit gated by inventory:edit
  // specifically (not isAdmin) — matches the same permission the standalone
  // Inventory > In & Out page already gates its own Edit action behind.
  // Approve / Reject right on a pending Inventory List row (admins) — a row
  // combining several movements acts on all of them (mergedIds).
  const approveAll = useApproveStockMovements()
  const rejectMany = useRejectStockMovements()
  const inventoryColumnOptions = React.useMemo(
    () => ({
      onEdit: can("inventory:edit") ? setEditingStockMovement : undefined,
      ...(isAdmin && user
        ? {
            onApprove: (m: StockMovementRow) => approveAll.mutate({ ids: m.mergedIds ?? [m.id], approvedBy: user.id }),
            onReject: (m: StockMovementRow) => rejectMany.mutate({ ids: m.mergedIds ?? [m.id], rejectedBy: user.id }),
            onMap: () => setInventoryQueueOpen(true),
          }
        : {}),
    }),
    // approveAll/rejectMany.mutate are stable; listing the mutation objects
    // would rebuild the columns on every pending-state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, setEditingStockMovement, isAdmin, user]
  )
  // The expanded modal always has every column; the panel itself picks a
  // column set that fits its current width (inventoryListDensityForWidth).
  const inventoryListExpandedColumns = React.useMemo(() => getInventoryListExpandedColumns(inventoryColumnOptions), [inventoryColumnOptions])
  const inventoryColumnsForWidth = React.useCallback(
    (width: number) => getInventoryListExpandedColumns({ ...inventoryColumnOptions, density: inventoryListDensityForWidth(width) }),
    [inventoryColumnOptions]
  )

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
  //
  // Strict same-day match on all four modules — mirrors AppSheet's own
  // daily behavior exactly: only what's actually scheduled for the selected
  // date belongs on this view. (Briefly tried showing Pending/overdue
  // backlog up to the selected date too, per an earlier read of AppSheet's
  // behavior; reverted since the real intent is a clean single-day list,
  // not a rolling backlog.)
  // Step 3 of the dispatch pipeline: a still-pending record reaches these
  // widgets only once its schedule job has the admin's final approval
  // (status 'pending', or already 'completed'). A record without a job, or
  // whose job is still a draft ('pending_approval'), waits in the Schedule's
  // Unscheduled Visits / drafts. A record already done always shows.
  // Technicians never receive draft jobs (RLS), so for them the same rule
  // holds automatically.
  const { data: scheduleJobs = [] } = useScheduleJobs()
  const approvedJobIds = React.useMemo(
    () => new Set(scheduleJobs.filter((j) => j.status === "pending" || j.status === "completed").map((j) => j.id)),
    [scheduleJobs]
  )
  const isApprovedForReport = React.useCallback(
    (r: { status: string; scheduleJobId?: string }) => r.status !== "Pending" || (!!r.scheduleJobId && approvedJobIds.has(r.scheduleJobId)),
    [approvedJobIds]
  )
  const dayFilterChangePlans = React.useMemo(
    () => filterChangePlans.filter((p) => (p.preD || p.planDate) === reportDate && isDailyReportEligible(p.dispatchStatus) && isApprovedForReport(p)),
    [filterChangePlans, reportDate, isApprovedForReport]
  )
  // InstallPlan has no preD field — its own equivalent "rescheduled date"
  // is preInstalledDate (input date is the plan/entry date, installedDate
  // is when it actually happened — see the InstallPlan type), so that's
  // what wins over inputDate here, same COALESCE semantics as the others.
  const dayInstallPlans = React.useMemo(
    () => installPlans.filter((p) => (p.preInstalledDate || p.inputDate) === reportDate && isDailyReportEligible(p.dispatchStatus) && isApprovedForReport(p)),
    [installPlans, reportDate, isApprovedForReport]
  )
  const dayRepairPlans = React.useMemo(
    () => repairPlans.filter((p) => (p.preD || p.issuedDate) === reportDate && isDailyReportEligible(p.dispatchStatus) && isApprovedForReport(p)),
    [repairPlans, reportDate, isApprovedForReport]
  )
  const dayCollectionPlans = React.useMemo(
    () => collectionPlans.filter((p) => (p.preD || p.collectionDate) === reportDate && isDailyReportEligible(p.dispatchStatus) && isApprovedForReport(p)),
    [collectionPlans, reportDate, isApprovedForReport]
  )
  // Filtered by the movement's own `date` (its as-of day — defaults to the
  // day it was recorded, and matches the completed job's scheduledDate for
  // the filter-change deduction path), same convention as every other
  // section here filtering by its own date field. This never approves
  // anything itself — that stays on Inventory > In & Out — but +Add/Edit
  // (both inventory:edit-gated) do let an admin create or fix a pending
  // movement straight from here; see getInventoryListExpandedColumns and
  // the inventory panel's own canAdd/onAdd below.
  // Only movements dated the report day — a movement dated another day shows
  // on that day's report even if it was approved today.
  const dayStockMovements = React.useMemo(
    () =>
      stockMovements.filter((m) => m.date === reportDate),
    [stockMovements, reportDate]
  )
  // One row per item per job (see groupInventoryListRows); the expanded
  // modal instead totals each item across all jobs (aggregateInventoryRowsByItem).
  const dayStockMovementRows = React.useMemo(() => groupInventoryListRows(dayStockMovements), [dayStockMovements])
  const dayStockItemTotals = React.useMemo(() => aggregateInventoryRowsByItem(dayStockMovementRows), [dayStockMovementRows])
  // The modal's Approve All: the pending items in this view (this day's
  // list), not every pending item app-wide like the header button — items
  // still to be mapped to a stock item are skipped, as there.
  const [approveViewOpen, setApproveViewOpen] = React.useState(false)
  const viewPending = React.useMemo(() => dayStockMovements.filter((m) => m.status === "pending"), [dayStockMovements])
  const viewApprovable = React.useMemo(() => viewPending.filter((m) => !!m.productId), [viewPending])

  // Approve all dates: every pending movement across all jobs and days, not
  // just this day's — except one still waiting to be mapped to a stock item
  // (an install model / hand-typed part), which needs the queue. Clicking it
  // first switches the expanded view to a review of ALL those items (one row
  // per item per job, with its date), and only "Confirm approve all"
  // approves them. Left when the expanded view closes or the date changes.
  const [reviewAllPending, setReviewAllPending] = React.useState(false)
  const [reviewDate, setReviewDate] = React.useState(reportDate)
  if (reviewDate !== reportDate) {
    setReviewDate(reportDate)
    setReviewAllPending(false)
  }
  const allPending = React.useMemo(() => stockMovements.filter((m) => m.status === "pending"), [stockMovements])
  const approvablePending = React.useMemo(() => allPending.filter((m) => !!m.productId), [allPending])
  const approvableJobCount = React.useMemo(
    () => new Set(approvablePending.map((m) => m.filterChangePlanId ?? m.installPlanId ?? m.scheduleJobId ?? m.referenceNumber)).size,
    [approvablePending]
  )
  // The review rows: oldest date first, one row per item per job.
  const allPendingRows = React.useMemo(
    () => groupInventoryListRows([...allPending].sort((a, b) => a.date.localeCompare(b.date))),
    [allPending]
  )
  const reviewColumns = React.useMemo(() => getInventoryListExpandedColumns({ ...inventoryColumnOptions, showDate: true }), [inventoryColumnOptions])

  // Raw panel content, unwrapped — always wrapped in SortablePanel +
  // ResizablePanel below (see resizable()). Titles come from the admin's
  // configured label (labelFor), not a hardcoded string.
  const rawContent: Record<PanelId, React.ReactNode> = {
    announcements: <AnnouncementPanel title={labelFor("announcements")} />,
    schedule: <ScheduleAgenda date={reportDate} title={labelFor("schedule")} />,
    "filter-change": (
      <DashboardPlanPanel
        title={labelFor("filter_change")}
        icon={Droplets}
        columns={filterChangeColumns}
        data={dayFilterChangePlans}
        loading={pFilter}
        emptyMessage={tFilterChange("noPlansForDate")}
        canAdd={isAdmin}
        onAdd={() => setFilterChangeFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteFilterChangePlans.mutateAsync(ids)}
        exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
        exportFileName="filter-change-plan"
        onRowClick={isAdmin ? (row) => router.push(`/filter-change?id=${row.id}`) : undefined}
        panelHeight={sizes["filter-change"]?.height}
        // Now the full 10-column set (see filterChangeColumns above) —
        // min-w-max forces the table to its natural, un-compressed content
        // width (every cell already renders whitespace-nowrap, see
        // components/ui/table.tsx) so it reliably overflows the panel and
        // scrolls instead of silently squeezing columns to fit. No separate
        // expandedTableClassName needed anymore: with no expandedColumns
        // prop, the Maximize2 dialog renders the exact same columns and
        // falls back to this same tableClassName (see DashboardPlanPanel's
        // own table() helper).
        tableContainerClassName="overflow-x-auto scrollbar-always-visible"
        tableClassName="min-w-max"
        getRowClassName={(row) => dispatchRowClassName(row.dispatchStatus)}
      />
    ),
    installation: (
      <DashboardPlanPanel
        title={labelFor("installation")}
        icon={HardHat}
        columns={installColumns}
        data={dayInstallPlans}
        loading={pInstall}
        emptyMessage={tInstall("noPlansForDate")}
        canAdd={isAdmin}
        onAdd={() => setInstallFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteInstallPlans.mutateAsync(ids)}
        exportColumns={INSTALL_EXPORT_COLUMNS}
        exportFileName="install-plan"
        onRowClick={isAdmin ? (row) => router.push(`/install?id=${row.id}`) : undefined}
        panelHeight={sizes.installation?.height}
        getRowClassName={(row) => dispatchRowClassName(row.dispatchStatus)}
      />
    ),
    repair: (
      <DashboardPlanPanel
        title={labelFor("repair")}
        icon={Wrench}
        columns={repairColumns}
        data={dayRepairPlans}
        loading={pRepair}
        emptyMessage={tRepair("noPlansForDate")}
        canAdd={isAdmin}
        onAdd={() => setRepairFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteRepairPlans.mutateAsync(ids)}
        exportColumns={REPAIR_EXPORT_COLUMNS}
        exportFileName="repair-plan"
        onRowClick={isAdmin ? (row) => router.push(`/repair-plan?id=${row.id}`) : undefined}
        panelHeight={sizes.repair?.height}
        getRowClassName={(row) => dispatchRowClassName(row.dispatchStatus)}
      />
    ),
    collection: (
      <DashboardPlanPanel
        title={labelFor("collection")}
        icon={Banknote}
        columns={collectionsColumns}
        data={dayCollectionPlans}
        loading={pCollections}
        emptyMessage={tCollection("noPlansForDate")}
        canAdd={isAdmin}
        onAdd={() => setCollectionsFormOpen(true)}
        canDelete={isAdmin}
        onDeleteSelected={(ids) => deleteCollections.mutateAsync(ids)}
        exportColumns={COLLECTIONS_EXPORT_COLUMNS}
        exportFileName="collection-plan"
        onRowClick={isAdmin ? (row) => router.push(`/collection-plan?id=${row.id}`) : undefined}
        panelHeight={sizes.collection?.height}
        tableContainerClassName="scrollbar-always-visible"
        getRowClassName={(row) => dispatchRowClassName(row.dispatchStatus)}
      />
    ),
    // Still no canDelete/onDeleteSelected, and it never approves anything
    // itself — approving a pending movement stays exactly where it already
    // was, on Inventory > In & Out — clicking through there is a
    // convenience, not a shortcut around that page's own admin-only approve
    // action. +Add and the trailing Edit column (both inventory:edit-gated,
    // not isAdmin — matches that same standalone page's own gate) are the
    // two exceptions, both via the same StockMovementFormDialog that page's
    // own Add/Edit already use.
    inventory: (
      <DashboardPlanPanel
        title={tInventory("inventoryListTitle")}
        icon={Package}
        canAdd={can("inventory:edit")}
        onAdd={() => setInventoryFormOpen(true)}
        // The full 10-column set (getInventoryListExpandedColumns) directly
        // in the compact panel now, not just the Maximize2 dialog — see the
        // "Enable Horizontal Scroll" change on the Filter Change panel just
        // above, same reasoning. tableClassName="min-w-max" forces the
        // table to its natural, un-compressed content width (every cell
        // already renders whitespace-nowrap, see components/ui/table.tsx)
        // so it reliably overflows the panel and scrolls instead of
        // silently squeezing columns to fit; tableContainerClassName makes
        // that scrollbar obviously visible rather than relying on the OS/
        // browser's own possibly-invisible-until-hover default (see
        // .scrollbar-always-visible in globals.css). No separate expanded
        // column set/tableClassName needed anymore: with no expandedColumns
        // prop, the dialog renders the exact same columns and falls back to
        // this same tableClassName.
        columns={inventoryListExpandedColumns}
        columnsForWidth={inventoryColumnsForWidth}
        data={dayStockMovementRows}
        expandedData={reviewAllPending ? allPendingRows : dayStockItemTotals}
        expandedColumns={reviewAllPending ? reviewColumns : undefined}
        onExpandedChange={(open) => !open && setReviewAllPending(false)}
        expandedToolbar={
          // Reviewing every pending item (see reviewAllPending): what will be
          // approved, then Confirm or Cancel.
          isAdmin && reviewAllPending ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-1.5 text-sm" data-testid="inventory-review-all-banner">
              <span>
                {tInventory("reviewAllBanner", { count: String(allPending.length), jobs: String(approvableJobCount) })}
                {allPending.length > approvablePending.length &&
                  " " + tInventory("approveAllPendingSkipped", { count: String(allPending.length - approvablePending.length) })}
              </span>
              <Button
                className="h-8 gap-1.5"
                disabled={approvablePending.length === 0 || approveAll.isPending}
                onClick={async () => {
                  if (!user) return
                  await approveAll.mutateAsync({ ids: approvablePending.map((m) => m.id), approvedBy: user.id }).catch(() => {})
                  setReviewAllPending(false)
                }}
                data-testid="inventory-confirm-approve-all"
              >
                <CheckCheck className="h-4 w-4" /> {tInventory("confirmApproveAll", { count: String(approvablePending.length) })}
              </Button>
              <Button variant="ghost" className="h-8" onClick={() => setReviewAllPending(false)} data-testid="inventory-cancel-review-all">
                {tCommon("cancel")}
              </Button>
              {approvablePending.length === 0 && (
                <Button variant="link" className="h-8 px-1" onClick={() => setInventoryQueueOpen(true)}>
                  {tInventory("approveAllPendingOpenQueue")}
                </Button>
              )}
            </div>
          ) : // Always there for an admin, next to search; disabled (with the
          // reason on hover) when nothing in this list can be approved. The
          // hint sits on a wrapper because a disabled button gets no pointer
          // events, so its own title would never show.
          isAdmin ? (
            <span
              className="inline-flex"
              title={
                viewPending.length === 0
                  ? tInventory("approveAllNoPending")
                  : viewApprovable.length === 0
                    ? tInventory("approveAllNeedsMapping")
                    : undefined
              }
            >
              <Button className="h-9 gap-1.5" disabled={viewApprovable.length === 0} onClick={() => setApproveViewOpen(true)}>
                <CheckCheck className="h-4 w-4" /> {tInventory("approveAllInView", { count: String(viewApprovable.length) })}
              </Button>
              {/* Every pending item on every date, in one go (the header's
                  button only covers the selected date). */}
              {allPending.length > 0 && (
                <Button variant="outline" className="ml-2 h-9 gap-1.5" onClick={() => setReviewAllPending(true)} data-testid="inventory-approve-all-dates">
                  <CheckCheck className="h-4 w-4" /> {tInventory("approveAllDates", { count: String(allPending.length) })}
                </Button>
              )}
            </span>
          ) : undefined
        }
        headerActions={
          // "Approve all (N)" matches the table: only the selected date's
          // pending items that can be approved (mapped to a stock item), and
          // hidden when there are none — never a count of other days' items
          // next to "No inventory movements for this date". Review shows the
          // pending total across all dates and stays whenever anything is
          // pending anywhere (even if it all still needs mapping), so the
          // backlog is never hidden; the all-dates approve is in the
          // expanded view's toolbar.
          isAdmin && allPending.length > 0 ? (
            <>
              {/* Full labels when the panel is wide, short ones when it's
                  narrow (container queries on the card header), so the
                  header stays on one row. */}
              {viewApprovable.length > 0 && (
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={() => setApproveViewOpen(true)} data-testid="inventory-approve-all">
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span className="hidden @2xl/card-header:inline">{tInventory("approveAllInView", { count: String(viewApprovable.length) })}</span>
                  <span className="@2xl/card-header:hidden">{tInventory("approveAllShort", { count: String(viewApprovable.length) })}</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2"
                title={tInventory("reviewQueueHint")}
                aria-label={tInventory("reviewQueueCount", { count: String(allPending.length) })}
                onClick={() => setInventoryQueueOpen(true)}
                data-testid="inventory-review-queue"
              >
                <PackageCheck className="h-3.5 w-3.5" />
                <span className="hidden @2xl/card-header:inline">{tInventory("reviewQueueCount", { count: String(allPending.length) })}</span>
                <span className="@2xl/card-header:hidden">{allPending.length}</span>
              </Button>
            </>
          ) : undefined
        }
        loading={pInventory}
        emptyMessage={tInventory("noMovementsForDate")}
        exportColumns={INVENTORY_LIST_EXPORT_COLUMNS}
        exportFileName="inventory-list"
        onRowClick={() => router.push("/inventory/in-and-out")}
        panelHeight={sizes.inventory?.height}
        tableContainerClassName="overflow-x-auto"
        expandedTableClassName="min-w-max"
      />
    ),
  }

  return (
    <div className="space-y-6">
      {/* Always rendered now (previously admin-only) so a technician still has
          a way to change the report date — the Layout toggle and Pending
          Dispatch Approval stay admin-only inside it. Date sits immediately
          before Approval; ml-auto on it (only when there's admin content to
          its left to push away from) pulls both over to the right edge
          together, matching the "next to Pending Dispatch Approval" request. */}
      <div className="flex items-center gap-2 flex-wrap">
        {isAdmin && (
          <>
            <span className="text-sm font-medium text-muted-foreground">{tCommon("layout")}:</span>
            <div className="inline-flex rounded-lg border p-0.5">
              <Button
                type="button"
                size="sm"
                variant={layoutMode === "stacked" ? "default" : "ghost"}
                className="gap-1.5"
                onClick={() => handleLayoutModeChange("stacked")}
              >
                <Rows3 className="h-3.5 w-3.5" /> {tCommon("stacked")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={isGrid ? "default" : "ghost"}
                className="gap-1.5"
                onClick={() => handleLayoutModeChange("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5" /> {tCommon("grid")}
              </Button>
            </div>
          </>
        )}
        <DailyReportDateButton value={reportDate} onChange={setReportDate} className={isAdmin ? "ml-auto" : undefined} />
        <DailyReportExportMenu
          reportDate={reportDate}
          filterChanges={dayFilterChangePlans}
          installs={dayInstallPlans}
          repairs={dayRepairPlans}
          collections={dayCollectionPlans}
          stockMovements={dayStockMovements}
        />
        {isAdmin && (
          <>
            <Button
              type="button"
              size="sm"
              variant={dispatchApprovalCount > 0 ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => setDispatchQueueOpen(true)}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
              {tDispatch("title")}{dispatchApprovalCount > 0 ? ` (${dispatchApprovalCount})` : ""}
            </Button>
            <DispatchApprovalQueue open={dispatchQueueOpen} onOpenChange={setDispatchQueueOpen} />
            <StockMovementApprovalQueue open={inventoryQueueOpen} onOpenChange={setInventoryQueueOpen} />
            <ConfirmDialog
              open={approveViewOpen}
              onOpenChange={setApproveViewOpen}
              title={tInventory("approveAllInViewTitle")}
              description={
                tInventory("approveAllInViewDescription", { count: String(viewApprovable.length) }) +
                (viewPending.length > viewApprovable.length
                  ? " " + tInventory("approveAllPendingSkipped", { count: String(viewPending.length - viewApprovable.length) })
                  : "")
              }
              confirmLabel={tInventory("approveAllPendingConfirm")}
              destructive={false}
              loading={approveAll.isPending}
              onConfirm={async () => {
                if (!user) return
                await approveAll.mutateAsync({ ids: viewApprovable.map((m) => m.id), approvedBy: user.id }).catch(() => {})
                setApproveViewOpen(false)
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setAllCollectionOpen(true)}
            >
              <Banknote className="h-3.5 w-3.5" />
              {tAllCollection("buttonLabel")}
            </Button>
            <AllCollectionDialog open={allCollectionOpen} onOpenChange={setAllCollectionOpen} />
          </>
        )}
      </div>

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
                canResize={!!user}
                width={sizes[id]?.width}
                height={sizes[id]?.height}
                defaultWidthClassName={defaultWidthClassName(id, isGrid, isAdmin)}
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
      <StockMovementFormDialog
        open={inventoryFormOpen || !!editingStockMovement}
        onOpenChange={(o) => {
          if (!o) {
            setInventoryFormOpen(false)
            setEditingStockMovement(undefined)
          }
        }}
        movement={editingStockMovement}
        defaultDate={reportDate}
      />
    </div>
  )
}
