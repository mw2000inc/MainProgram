"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDownCircle, ArrowUpCircle, ArrowLeftRight, Filter, Maximize2, Plus } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { StockMovementFormDialog } from "@/components/inventory/stock-movement-form-dialog"
import { getStockMovementsColumns, type StockMovementRow } from "@/components/inventory/stock-movements-columns"
import { useApproveStockMovement, useDeleteStockMovement, useStockMovementRows } from "@/lib/hooks/use-inventory"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"

type Direction = "in" | "out"
type Selection = { direction: Direction; date: string | "all" } | undefined

interface DateCount {
  date: string
  count: number
}

function aggregateByDate(rows: StockMovementRow[], direction: Direction): { entries: DateCount[]; total: number } {
  const totals = new Map<string, number>()
  let total = 0
  for (const r of rows) {
    const qty = direction === "in" ? r.quantityAdded : r.quantityRemoved
    if (qty <= 0) continue
    totals.set(r.date, (totals.get(r.date) ?? 0) + qty)
    total += qty
  }
  const entries = Array.from(totals, ([date, count]) => ({ date, count })).sort((a, b) =>
    b.date.localeCompare(a.date)
  )
  return { entries, total }
}

// Same header chrome (Add / Filter / Expand) as the daily-report dashboard panels
// (Filter Change Plan, Install, etc.), adapted to this panel's date+count shape —
// "Filter" narrows by movement reason (the closest analog to those panels' status
// filter), and "Expand" opens the same full-view dialog treatment.
function DateCountPanel({
  title,
  icon: Icon,
  tone,
  direction,
  rows,
  onSelect,
  onAdd,
}: {
  title: string
  icon: React.ElementType
  tone: "success" | "danger"
  direction: Direction
  rows: StockMovementRow[]
  onSelect: (selection: Selection) => void
  onAdd: () => void
}) {
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const [showReasonFilter, setShowReasonFilter] = React.useState(false)
  const [reasonFilter, setReasonFilter] = React.useState<string>("all")
  const [expanded, setExpanded] = React.useState(false)

  const directionRows = React.useMemo(
    () => rows.filter((r) => (direction === "in" ? r.quantityAdded : r.quantityRemoved) > 0),
    [rows, direction]
  )
  const reasonOptions = React.useMemo(
    () => Array.from(new Set(directionRows.map((r) => r.reason))),
    [directionRows]
  )
  const filteredRows = React.useMemo(
    () => (reasonFilter === "all" ? directionRows : directionRows.filter((r) => r.reason === reasonFilter)),
    [directionRows, reasonFilter]
  )
  const { entries, total } = React.useMemo(() => aggregateByDate(filteredRows, direction), [filteredRows, direction])

  const toneClass = tone === "success" ? "text-success" : "text-danger"

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className={`h-4 w-4 ${toneClass}`} /> {title}
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" className="h-7 gap-1 px-2" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> {tCommon("add")}
        </Button>
        <Button
          variant={showReasonFilter ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          title={t("filterByReason")}
          onClick={() => setShowReasonFilter((v) => !v)}
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={tCommon("expand")}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )

  const filterRow = showReasonFilter && (
    <Select value={reasonFilter} onValueChange={setReasonFilter}>
      <SelectTrigger className="h-8 w-40">
        <SelectValue placeholder={t("reason")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("allReasons")}</SelectItem>
        {reasonOptions.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  const list = (maxHeightClass: string) => (
    <div className={`${maxHeightClass} overflow-y-auto divide-y`}>
      <button
        onClick={() => onSelect({ direction, date: "all" })}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
      >
        <span className="font-medium">{tCommon("all")}</span>
        <span className="text-muted-foreground">{total}</span>
      </button>
      {entries.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("noMovementsRecorded")}</p>
      )}
      {entries.map((e) => (
        <button
          key={e.date}
          onClick={() => onSelect({ direction, date: e.date })}
          className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
        >
          <span>{formatDate(e.date)}</span>
          <span className="text-muted-foreground">{e.count}</span>
        </button>
      ))}
    </div>
  )

  return (
    <>
      <Card>
        <CardHeader className="gap-2 pb-2">
          {header}
          {filterRow}
        </CardHeader>
        <CardContent className="p-0">{list("max-h-[560px]")}</CardContent>
      </Card>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${toneClass}`} /> {title}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {filterRow}
            {list("")}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function InAndOutSummaryContent() {
  const { user, can } = useAuth()
  const { t } = useTranslation("inventory")
  const { data: rows, isPending } = useStockMovementRows()
  const deleteMovement = useDeleteStockMovement()
  const approveMovement = useApproveStockMovement()

  // Deep link from the Activity Log (?id=<movementId>) — opens that
  // movement's edit dialog directly, the closest thing this page has to a
  // per-record view (the page itself is otherwise a date-bucket drilldown,
  // not a flat list of individual movements).
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined
  const openedInitialRef = React.useRef(false)

  const [selection, setSelection] = React.useState<Selection>(undefined)
  const [formOpen, setFormOpen] = React.useState(false)
  const [addDirection, setAddDirection] = React.useState<Direction>("in")
  const [editing, setEditing] = React.useState<StockMovementRow | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<StockMovementRow | undefined>(undefined)

  useDeepLinkNotFoundToast(initialId, isPending, (rows ?? []).some((r) => r.id === initialId))

  React.useEffect(() => {
    if (!initialId || isPending || openedInitialRef.current) return
    const match = (rows ?? []).find((r) => r.id === initialId)
    if (!match) return
    openedInitialRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(match)
    setFormOpen(true)
  }, [initialId, isPending, rows])

  function handleAdd(direction: Direction) {
    setEditing(undefined)
    setAddDirection(direction)
    setFormOpen(true)
  }

  const drilldownRows = React.useMemo(() => {
    if (!selection) return []
    return rows.filter((r) => {
      const qty = selection.direction === "in" ? r.quantityAdded : r.quantityRemoved
      if (qty <= 0) return false
      if (selection.date !== "all" && r.date !== selection.date) return false
      return true
    })
  }, [rows, selection])

  const columns = React.useMemo(
    () =>
      getStockMovementsColumns({
        canEdit: can("inventory:edit"),
        canDelete: can("inventory:delete"),
        canApprove: can("inventory:edit"),
        onEdit: (m) => {
          setEditing(m)
          setFormOpen(true)
        },
        onDelete: (m) => setDeleting(m),
        onApprove: (m) => {
          if (!user) return
          approveMovement.mutate({ id: m.id, approvedBy: user.id })
        },
      }),
    [can, user, approveMovement]
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6 text-primary" /> {t("inAndOutSummary")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("inAndOutDescription")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DateCountPanel
          title={t("inStock")}
          icon={ArrowDownCircle}
          tone="success"
          direction="in"
          rows={rows}
          onSelect={setSelection}
          onAdd={() => handleAdd("in")}
        />
        <DateCountPanel
          title={t("outStock")}
          icon={ArrowUpCircle}
          tone="danger"
          direction="out"
          rows={rows}
          onSelect={setSelection}
          onAdd={() => handleAdd("out")}
        />
      </div>

      <Dialog open={!!selection} onOpenChange={(o) => !o && setSelection(undefined)}>
        <DialogContent className="w-[96vw] sm:max-w-[96vw] h-[92vh] max-h-[92vh] flex flex-col gap-0 p-0">
          <DialogHeader className="border-b p-4 pb-3">
            <DialogTitle>
              {selection?.direction === "in" ? t("inStock") : t("outStock")} —{" "}
              {selection?.date === "all" ? t("allDates") : selection ? formatDate(selection.date) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <DataTable
              columns={columns}
              data={drilldownRows}
              emptyMessage={t("noMovementsFound")}
              pageSize={Math.max(drilldownRows.length, 1)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <StockMovementFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        movement={editing}
        defaultDirection={addDirection}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteStockMovementTitle")}
        description={
          deleting?.reason === "Sale"
            ? t("deleteMovementSaleDescription", { product: deleting?.productName ?? t("theProduct") })
            : deleting?.reason === "Filter Change"
              ? t("deleteMovementFilterChangeDescription", { product: deleting?.productName ?? t("theProduct") })
              : t("deleteMovementGenericDescription", { product: deleting?.productName ?? t("theProduct") })
        }
        loading={deleteMovement.isPending}
        onConfirm={async () => {
          if (!deleting) return
          try {
            await deleteMovement.mutateAsync(deleting.id)
            setDeleting(undefined)
          } catch {
            // handled by the mutation's onError toast
          }
        }}
      />
    </div>
  )
}

function InAndOutSummaryFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function InAndOutSummaryPage() {
  return (
    <React.Suspense fallback={<InAndOutSummaryFallback />}>
      <InAndOutSummaryContent />
    </React.Suspense>
  )
}
