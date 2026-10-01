"use client"

import * as React from "react"
import { StatusBadge } from "@/components/shared/status-badge"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"

// The Schedule table's "Inventory / Approved By" cell: what the job queued or
// used from stock, and where its approval stands (pending count, who
// approved, rejected count). Clicking it opens the job's full Inventory
// History (StockMovementHistoryDialog in job mode), where pending items can
// also be approved or rejected.
export function JobInventoryCell({ movements, onOpen }: { movements: StockMovementRow[]; onOpen: () => void }) {
  const { t } = useTranslation("schedule")
  if (movements.length === 0) return <span className="text-muted-foreground">—</span>

  const itemNames = [...new Set(movements.map((m) => m.productName))]
  const pending = movements.filter((m) => m.status === "pending").length
  const rejected = movements.filter((m) => m.status === "rejected").length
  const approved = movements.filter((m) => m.status !== "pending" && m.status !== "rejected")
  const approvers = [...new Set(approved.map((m) => m.approvedByName).filter(Boolean))]

  return (
    <button
      type="button"
      data-testid="schedule-inventory-trigger"
      title={t("inventoryViewHistory")}
      onClick={onOpen}
      className="-mx-1 max-w-[16rem] rounded px-1 py-0.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="truncate text-xs">{itemNames.join(", ")}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {pending > 0 && <StatusBadge tone="warning" label={t("inventoryPendingCount", { count: pending })} />}
        {approved.length > 0 && (
          <StatusBadge
            tone="success"
            label={approvers.length > 0 ? t("inventoryApprovedBy", { name: approvers.join(", ") }) : t("inventoryApprovedCount", { count: approved.length })}
          />
        )}
        {rejected > 0 && <StatusBadge tone="danger" label={t("inventoryRejectedCount", { count: rejected })} />}
      </div>
    </button>
  )
}
