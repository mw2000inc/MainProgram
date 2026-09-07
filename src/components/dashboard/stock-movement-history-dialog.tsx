"use client"

import * as React from "react"
import { Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useStockMovementRows } from "@/lib/hooks/use-inventory"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"

// Admin approval history for stock movements — same shape as
// DispatchHistoryDialog, adapted to inventory's own fields. Read-only and
// deliberately separate from StockMovementApprovalQueue, same reasoning as
// that dialog's own dispatch counterpart: a growing historical list would
// muddy "nothing is waiting" as the pending queue's own empty state.
//
// Shows approvals only, not rejections — investigated first: stock_movements
// .status has no 'rejected'/'declined' value at all (the DB check constraint
// only allows 'pending'/'approved'), and the approval queue has no reject
// action either. The closest real precedent for "not approving" something is
// an admin deleting a still-pending row outright via Inventory's generic
// delete permission (found twice in this project's own activity_logs) — but
// that leaves no trace in stock_movements itself, and a delete isn't a
// reliable signal of deliberate rejection (could just as easily be cleaning
// up a duplicate or a mistake), so it's deliberately not surfaced here as a
// "declined" entry. Flagged and decided explicitly rather than guessed at.
//
// A movement only counts as history here when it actually went through this
// approval queue — status === 'approved' AND approvedByName is set. A manual
// Stock Movement entry from Inventory > In & Out is auto-approved with no
// approvedBy at all (see StockMovementRow's own comment), so it's correctly
// excluded: no admin decision was ever made on it.
export function StockMovementHistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { data: movements = [], isPending } = useStockMovementRows()
  const [search, setSearch] = React.useState("")

  const history = React.useMemo(
    () =>
      movements
        .filter((m) => m.status === "approved" && m.approvedByName)
        .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? "")),
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
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
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

        {isPending ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{tCommon("loading")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {history.length === 0 ? t("noHistoryYet") : t("noHistoryMatches")}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <div key={m.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{m.productName}</p>
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
                  {t("requestedBy", { name: m.userName })} · {t("historyApprovedBy", { name: m.approvedByName ?? "" })}
                  {m.approvedAt ? ` · ${formatDateTime(m.approvedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
