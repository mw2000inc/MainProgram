"use client"

import * as React from "react"
import Link from "next/link"
import { CheckCheck, ExternalLink, Search } from "lucide-react"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { ApprovalActionsCell, InventoryStatusBadge } from "@/components/inventory/inventory-list-columns"
import { useAuth } from "@/lib/auth/auth-context"
import {
  useApproveStockMovements,
  useRejectStockMovements,
  useStockMovementRows,
  type StockMovementRow,
} from "@/lib/hooks/use-inventory"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"

// Admin approval history for stock movements — same shape as
// DispatchHistoryDialog, adapted to inventory's own fields. Read-only and
// deliberately separate from StockMovementApprovalQueue, same reasoning as
// that dialog's own dispatch counterpart: a growing historical list would
// muddy "nothing is waiting" as the pending queue's own empty state.
//
// Shows both approved and rejected movements (see the
// stock_movement_rejection migration for the reject feature itself — this
// dialog originally only showed approvals, from before that feature
// existed). A movement only counts as history here when it actually went
// through this approval queue with a real decision recorded —
// (status === 'approved' && approvedByName) or
// (status === 'rejected' && rejectedByName). A manual Stock Movement entry
// from Inventory > In & Out is auto-approved with no approvedBy at all (see
// StockMovementRow's own comment), so it's correctly excluded: no admin
// decision was ever made on it.
//
// With `job` set (the Schedule table's Inventory / Approved By column) it is
// that one job's full inventory history instead: every movement linked to
// the job — pending ones included — with SKU, IN/OUT, who created it and
// when, who approved or rejected it and when, a link to the job's record,
// and, for an admin, Approve / Reject on the pending ones.
export interface StockMovementHistoryJob {
  id: string
  orderNo?: string
  // The job's linked Filter Change / install / repair / collection record.
  recordHref?: string
}

export function StockMovementHistoryDialog({
  open,
  onOpenChange,
  job,
  onMap,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job?: StockMovementHistoryJob
  // Job mode: opens the Inventory review queue for an item that still needs
  // mapping to a stock item before it can be approved.
  onMap?: () => void
}) {
  if (job) return <JobInventoryHistory open={open} onOpenChange={onOpenChange} job={job} onMap={onMap} />
  return <ApprovalHistory open={open} onOpenChange={onOpenChange} />
}

function ApprovalHistory({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { t: tStatus } = useTranslation("status")
  const { data: movements = [], isPending } = useStockMovementRows()
  const [search, setSearch] = React.useState("")

  const history = React.useMemo(
    () =>
      movements
        .filter(
          (m) => (m.status === "approved" && m.approvedByName) || (m.status === "rejected" && m.rejectedByName)
        )
        .sort((a, b) => (b.approvedAt ?? b.rejectedAt ?? "").localeCompare(a.approvedAt ?? a.rejectedAt ?? "")),
    [movements]
  )

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return history
    return history.filter(
      (m) =>
        m.productName.toLowerCase().includes(q) ||
        (m.relatedJobOrderNo ?? "").toLowerCase().includes(q) ||
        (m.relatedCustomerName ?? "").toLowerCase().includes(q)
    )
  }, [history, search])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("historyTitle")}</DialogTitle>
          <DialogDescription>{t("historyDescription")}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder={t("historySearchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <DialogBody>
        {isPending ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {history.length === 0 ? t("noHistoryYet") : t("noHistoryMatches")}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => {
              const approved = m.status === "approved"
              return (
                <div key={m.id} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium truncate">{m.productName}</span>
                        <StatusBadge tone={approved ? "success" : "danger"} label={approved ? tStatus("approved") : tStatus("rejected")} />
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {formatDate(m.date)}
                        {m.relatedJobOrderNo ? ` · ${m.relatedJobOrderNo}` : ""}
                        {m.relatedCustomerName ? ` · ${m.relatedCustomerName}` : ""}
                      </p>
                      {m.reason && <p className="text-xs text-muted-foreground truncate">{m.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.quantityRemoved > 0 && <span className="text-sm font-medium text-danger">-{m.quantityRemoved}</span>}
                      {m.quantityAdded > 0 && <span className="text-sm font-medium text-success">+{m.quantityAdded}</span>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("requestedBy", { name: m.userName })} ·{" "}
                    {approved
                      ? t("historyApprovedBy", { name: m.approvedByName ?? "" })
                      : t("historyRejectedBy", { name: m.rejectedByName ?? "" })}
                    {(m.approvedAt ?? m.rejectedAt) ? ` · ${formatDateTime((m.approvedAt ?? m.rejectedAt) as string)}` : ""}
                  </p>
                </div>
              )
            })}
          </div>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function JobInventoryHistory({
  open,
  onOpenChange,
  job,
  onMap,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: StockMovementHistoryJob
  onMap?: () => void
}) {
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: movements = [], isPending } = useStockMovementRows()
  const approve = useApproveStockMovements()
  const reject = useRejectStockMovements()
  const [search, setSearch] = React.useState("")

  const history = React.useMemo(
    () => movements.filter((m) => m.relatedScheduleJobId === job.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [movements, job.id]
  )
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return history
    return history.filter((m) => [m.productName, m.sku, m.reason, m.userName, m.approvedByName, m.rejectedByName].some((v) => (v ?? "").toLowerCase().includes(q)))
  }, [history, search])
  const pending = history.filter((m) => m.status === "pending")
  // Only mapped items can be approved (an approved movement needs a product).
  const approvable = pending.filter((m) => !!m.productId)
  const busy = approve.isPending || reject.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" data-testid="job-inventory-history">
        <DialogHeader>
          <DialogTitle>{t("jobHistoryTitle", { order: job.orderNo || "—" })}</DialogTitle>
          <DialogDescription>{t("jobHistoryDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8 h-9" placeholder={t("jobHistorySearchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {job.recordHref && (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={job.recordHref}>
                <ExternalLink className="h-3.5 w-3.5" /> {t("openJobRecord", { order: job.orderNo || "—" })}
              </Link>
            </Button>
          )}
          {isAdmin && user && approvable.length > 0 && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => approve.mutate({ ids: approvable.map((m) => m.id), approvedBy: user.id })}
            >
              <CheckCheck className="h-3.5 w-3.5" /> {t("approveJobPending", { count: approvable.length })}
            </Button>
          )}
        </div>

        <DialogBody>
          {isPending ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{history.length === 0 ? t("jobHistoryEmpty") : t("noHistoryMatches")}</p>
          ) : (
            <div className="space-y-3">
              {filtered.map((m) => (
                <JobMovementCard
                  key={m.id}
                  movement={m}
                  orderNo={m.relatedJobOrderNo || job.orderNo}
                  recordHref={job.recordHref}
                  actions={
                    isAdmin && user && !busy ? (
                      <ApprovalActionsCell
                        movement={m}
                        onApprove={(mv) => approve.mutate({ ids: [mv.id], approvedBy: user.id })}
                        onReject={(mv) => reject.mutate({ ids: [mv.id], rejectedBy: user.id })}
                        onMap={() => onMap?.()}
                      />
                    ) : null
                  }
                />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function JobMovementCard({
  movement: m,
  orderNo,
  recordHref,
  actions,
}: {
  movement: StockMovementRow
  orderNo: string | undefined
  recordHref: string | undefined
  actions: React.ReactNode
}) {
  const { t } = useTranslation("inventory")
  const isIn = m.quantityAdded > 0 && m.quantityRemoved === 0
  const qty = isIn ? m.quantityAdded : m.quantityRemoved
  return (
    <div className="rounded-md border p-3 space-y-2" data-testid="job-inventory-movement">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{m.productName}</span>
            <InventoryStatusBadge status={m.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("skuLabel", { sku: m.productId ? m.sku : t("notMappedYet") })} · {m.reason}
            {m.source === "Manual" ? ` · ${t("manualEntry")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge tone={isIn ? "success" : "neutral"} label={isIn ? "IN" : "OUT"} />
          <span className={isIn ? "text-sm font-medium text-success" : "text-sm font-medium text-danger"}>
            {isIn ? "+" : "-"}
            {qty}
          </span>
        </div>
      </div>
      <div className="grid gap-0.5 text-xs text-muted-foreground">
        <span>{t("createdByAt", { name: m.userName, time: formatDateTime(m.createdAt) })}</span>
        {m.status === "approved" && (
          <span className="text-success">
            {m.approvedByName
              ? t("approvedByAt", { name: m.approvedByName, time: m.approvedAt ? formatDateTime(m.approvedAt) : "—" })
              : t("recordedWithoutApproval")}
          </span>
        )}
        {m.status === "rejected" && (
          <span className="text-danger">{t("rejectedByAt", { name: m.rejectedByName ?? "—", time: m.rejectedAt ? formatDateTime(m.rejectedAt) : "—" })}</span>
        )}
        {m.status === "pending" && <span className="text-warning">{t("awaitingApproval")}</span>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {orderNo ? (
          recordHref ? (
            <Link href={recordHref} className="text-xs font-medium text-primary hover:underline">
              {orderNo}
            </Link>
          ) : (
            <span className="text-xs font-medium">{orderNo}</span>
          )
        ) : (
          <span />
        )}
        {actions}
      </div>
    </div>
  )
}
