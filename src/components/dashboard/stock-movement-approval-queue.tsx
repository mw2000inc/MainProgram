"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, CheckCheck, History, X } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StockMovementHistoryDialog } from "@/components/dashboard/stock-movement-history-dialog"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { useProducts, useStockMovementRows, useApproveStockMovement, useRejectStockMovement, type StockMovementRow } from "@/lib/hooks/use-inventory"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { listRepairPlanIdsForParts } from "@/lib/api/repair-plan-parts"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"
import type { ScheduleJobType } from "@/lib/types"

// Admin approval queue for pending stock movements — the items a completed
// job used, waiting for an admin before stock changes:
//   - a Filter Change visit marked Completed / given an Acc D queues one
//     movement per filter in its Filter (filter_change_inventory_queue
//     migration)
//   - a schedule job's recorded filter items (ct_filter_change_collection_
//     inventory_link migration)
//   - a repair's recorded parts, catalog or hand-typed (repair_plan_parts_
//     stock_movement, inventory_queue_installs_repairs migrations)
//   - an install given its Installed Date — one unit of its model
//     (inventory_queue_installs_repairs migration)
// An install model or hand-typed part with no matching product arrives
// unmapped (showing what was recorded); the admin picks the stock item
// before it can be approved.
// A manual Stock Movement entry from Inventory > In & Out is approved
// immediately and never shows up here.
//
// Grouped per job, with the job's service type, customer, order, technician
// and completed date. Each item can be switched to a different product or
// quantity before approving (the technician used a different filter), and
// the adjustment is saved in the same update as the approval — so the
// approval trigger deducts what was actually used. Rejecting never touches
// stock.

interface QueueGroup {
  key: string
  serviceType: ScheduleJobType | "other"
  customer: string
  orderNo: string
  technician: string
  completedDate: string
  // Filter codes on the visit with no matching product, so never queued.
  notInInventory: string[]
  items: StockMovementRow[]
}

type Adjustment = { productId?: string; quantity?: string }

export function StockMovementApprovalQueue({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const { data: movements = [] } = useStockMovementRows()
  const { data: products = [] } = useProducts()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: scheduleJobs = [] } = useScheduleJobs()
  const { data: installPlans = [] } = useInstallPlans()
  const approve = useApproveStockMovement()
  const reject = useRejectStockMovement()
  const { t } = useTranslation("inventory")
  const { t: tSchedule } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [adjustments, setAdjustments] = React.useState<Record<string, Adjustment>>({})
  const [busy, setBusy] = React.useState(false)
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  // Never reopen already full-screen from a previous session — this
  // component stays mounted across open/close (only `open` toggles
  // visibility), so without this the state would otherwise just persist.
  React.useEffect(() => {
    if (!open) exitFullScreen()
  }, [open, exitFullScreen])

  const pending = React.useMemo(
    () => movements.filter((m) => m.status === "pending").sort((a, b) => a.date.localeCompare(b.date)),
    [movements]
  )

  const partIds = React.useMemo(() => pending.map((m) => m.repairPlanPartId).filter((id): id is string => !!id).sort(), [pending])
  const { data: repairPlanIdByPart = {} } = useQuery({
    queryKey: ["repairPlanIdsForParts", partIds],
    queryFn: () => listRepairPlanIdsForParts(partIds),
    enabled: open && partIds.length > 0,
  })

  const groups = React.useMemo<QueueGroup[]>(() => {
    const skus = new Set(products.map((p) => p.sku.trim()))
    const fcById = new Map(filterChangePlans.map((p) => [p.id, p]))
    const jobById = new Map(scheduleJobs.map((j) => [j.id, j]))
    const repairById = new Map(repairPlans.map((r) => [r.id, r]))
    const installById = new Map(installPlans.map((i) => [i.id, i]))
    const byKey = new Map<string, QueueGroup>()
    for (const m of pending) {
      let group: Omit<QueueGroup, "items">
      const plan = m.filterChangePlanId ? fcById.get(m.filterChangePlanId) : undefined
      const job = !plan && m.scheduleJobId ? jobById.get(m.scheduleJobId) : undefined
      const install = !plan && !job && m.installPlanId ? installById.get(m.installPlanId) : undefined
      const repairId = !plan && !job && !install && m.repairPlanPartId ? repairPlanIdByPart[m.repairPlanPartId] : undefined
      const repair = repairId ? repairById.get(repairId) : undefined
      if (plan) {
        const codes = [...new Set(plan.filterType.split(",").map((c) => c.trim()).filter(Boolean))]
        group = {
          key: `fc-${plan.id}`,
          serviceType: "filter_change",
          customer: plan.memberAccount,
          orderNo: plan.orderNumber,
          technician: plan.serviceman ? formatTechnicians(plan.serviceman, plan.serviceman2 ?? "", "&") : "",
          completedDate: plan.accD ?? m.date,
          notInInventory: codes.filter((c) => !skus.has(c)),
        }
      } else if (job) {
        group = {
          key: `job-${job.id}`,
          serviceType: job.jobType,
          customer: m.relatedCustomerName ?? "",
          orderNo: m.relatedJobOrderNo ?? job.orderNo ?? "",
          technician: formatTechnicians(job.technician, job.technician2 ?? "", "&"),
          completedDate: job.scheduledDate,
          notInInventory: [],
        }
      } else if (install) {
        group = {
          key: `ins-${install.id}`,
          serviceType: "installation",
          customer: install.name,
          orderNo: install.orderNo,
          technician: install.serviceman ? formatTechnicians(install.serviceman, install.serviceman2 ?? "", "&") : "",
          completedDate: install.installedDate ?? m.date,
          notInInventory: [],
        }
      } else if (repair) {
        group = {
          key: `rep-${repair.id}`,
          serviceType: "repair",
          customer: repair.accountName,
          orderNo: repair.orderNo,
          technician: repair.th ? formatTechnicians(repair.th, repair.th2 ?? "", "&") : "",
          completedDate: repair.accD ?? m.date,
          notInInventory: [],
        }
      } else {
        group = {
          // Grouped by reason + order until the job itself is known (e.g. a
          // repair part's plan lookup still loading), so a job's items stay
          // together rather than showing as one group each.
          key: m.referenceNumber ? `ref-${m.reason}-${m.referenceNumber}` : `mv-${m.id}`,
          serviceType:
            m.reason === "Repair" ? "repair" : m.reason === "Filter Change" ? "filter_change" : m.reason === "Installation" ? "installation" : "other",
          customer: m.relatedCustomerName ?? "",
          orderNo: m.referenceNumber,
          technician: "",
          completedDate: m.date,
          notInInventory: [],
        }
      }
      const existing = byKey.get(group.key)
      if (existing) existing.items.push(m)
      else byKey.set(group.key, { ...group, items: [m] })
    }
    return [...byKey.values()]
  }, [pending, products, filterChangePlans, scheduleJobs, repairPlans, installPlans, repairPlanIdByPart])

  const productOptions = React.useMemo(
    () => [...products].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true })),
    [products]
  )

  const adjustedFor = (m: StockMovementRow) => {
    const a = adjustments[m.id] ?? {}
    const productId = a.productId && a.productId !== m.productId ? a.productId : undefined
    const qty = a.quantity !== undefined ? Number(a.quantity) : undefined
    const quantityRemoved = qty !== undefined && Number.isInteger(qty) && qty > 0 && qty !== m.quantityRemoved ? qty : undefined
    const invalid = a.quantity !== undefined && !(Number.isInteger(qty) && (qty as number) > 0)
    // An unmapped item (install model / hand-typed part) can't be approved
    // until a stock item is picked — approval needs a product.
    const needsMapping = !m.productId && !a.productId
    return { productId, quantityRemoved, invalid, needsMapping, changed: productId !== undefined || quantityRemoved !== undefined }
  }

  async function approveItems(items: StockMovementRow[]) {
    if (!user) return
    setBusy(true)
    try {
      for (const m of items) {
        const { productId, quantityRemoved, invalid, needsMapping } = adjustedFor(m)
        if (invalid || needsMapping) continue
        // Only a removal's quantity is adjustable — every queued item is one.
        await approve.mutateAsync({ id: m.id, approvedBy: user.id, adjust: m.quantityRemoved > 0 ? { productId, quantityRemoved } : { productId } })
      }
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || approve.isPending || reject.isPending || !user

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // The plain (unprefixed) max-w-none alone isn't enough to actually
          // go full-width above the sm: breakpoint — cn()'s tailwind-merge
          // only dedupes classes within the same variant, so sm:max-w-* needs
          // its own sm:max-w-none.
          className={cn(
            isFullScreen
              ? "inset-0 top-0 left-0 h-screen max-h-screen w-screen max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-6"
              : "sm:max-w-3xl max-h-[85vh]",
            // Never scrolls itself — DialogBody below is the scroll region, so
            // the X/full-screen/History buttons stay pinned above the list.
            "flex flex-col overflow-hidden"
          )}
          // Escape exits full-screen first instead of closing the dialog.
          onEscapeKeyDown={(e) => {
            if (isFullScreen) {
              e.preventDefault()
              exitFullScreen()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span>{t("pendingApprovalButton")}</span>
              <div className="flex items-center gap-2">
                <FullScreenToggleButton isFullScreen={isFullScreen} onToggle={toggleFullScreen} />
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 font-normal" onClick={() => setHistoryOpen(true)}>
                  <History className="h-3.5 w-3.5" /> {t("historyButton")}
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>{t("pendingApprovalDescription")}</DialogDescription>
          </DialogHeader>

          <DialogBody>
            {groups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("nothingPendingApproval")}</p>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.key} data-testid="approval-group" className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {g.serviceType === "other" ? t("queueOtherType") : tSchedule(g.serviceType)}
                          {g.orderNo && <span className="text-muted-foreground"> · {g.orderNo}</span>}
                          {g.customer && <span> · {g.customer}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {g.technician ? `${t("queueTechnician")}: ${g.technician} · ` : ""}
                          {t("queueCompleted", { date: formatDate(g.completedDate) })}
                        </p>
                        {g.notInInventory.length > 0 && (
                          <p className="text-xs text-warning">{t("queueNotInInventory", { codes: g.notInInventory.join(", ") })}</p>
                        )}
                      </div>
                      {g.items.length > 1 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5"
                          disabled={disabled || g.items.some((m) => adjustedFor(m).needsMapping || adjustedFor(m).invalid)}
                          onClick={() => approveItems(g.items)}
                        >
                          <CheckCheck className="h-3.5 w-3.5" /> {t("queueApproveAll")}
                        </Button>
                      )}
                    </div>
                    {g.items.map((m) => {
                      const a = adjustments[m.id] ?? {}
                      const adj = adjustedFor(m)
                      return (
                        <div key={m.id} data-testid="approval-item" className="flex flex-wrap items-center gap-2 rounded bg-muted/40 px-2 py-1.5">
                          {!m.productId && m.itemLabel && (
                            <p className="w-full text-xs text-muted-foreground">
                              {t("queueRecordedAs", { label: m.itemLabel })}
                            </p>
                          )}
                          <Select
                            value={a.productId ?? (m.productId || undefined)}
                            onValueChange={(productId) => setAdjustments((old) => ({ ...old, [m.id]: { ...old[m.id], productId } }))}
                          >
                            <SelectTrigger
                              className={cn("h-8 min-w-0 flex-1 text-xs", adj.needsMapping && "border-warning")}
                              aria-label={t("queueItem")}
                            >
                              <SelectValue placeholder={t("queueMapItem")} />
                            </SelectTrigger>
                            <SelectContent className="max-h-64">
                              {productOptions.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name.startsWith(`${p.sku} / `) ? p.name : `${p.sku} / ${p.name}`} ({p.stockQuantity})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {m.quantityRemoved > 0 ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">−</span>
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                aria-label={t("queueQuantity")}
                                className={cn("h-8 w-16 text-xs", adj.invalid && "border-danger")}
                                value={a.quantity ?? String(m.quantityRemoved)}
                                onChange={(e) => setAdjustments((old) => ({ ...old, [m.id]: { ...old[m.id], quantity: e.target.value } }))}
                              />
                            </div>
                          ) : (
                            m.quantityAdded > 0 && <span className="text-sm font-medium text-success">+{m.quantityAdded}</span>
                          )}
                          {adj.changed && <span className="text-[11px] text-primary">{t("queueAdjusted")}</span>}
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-8 gap-1.5"
                            disabled={disabled}
                            onClick={() => user && reject.mutate({ id: m.id, rejectedBy: user.id })}
                          >
                            <X className="h-3.5 w-3.5" /> {tCommon("reject")}
                          </Button>
                          <Button size="sm" className="h-8 gap-1.5" disabled={disabled || adj.invalid || adj.needsMapping} onClick={() => approveItems([m])}>
                            <Check className="h-3.5 w-3.5" /> {tCommon("approve")}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <StockMovementHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  )
}
