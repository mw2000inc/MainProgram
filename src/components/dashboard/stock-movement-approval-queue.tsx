"use client"

import * as React from "react"
import { Check, History, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { StockMovementHistoryDialog } from "@/components/dashboard/stock-movement-history-dialog"
import { FullScreenToggleButton } from "@/components/shared/fullscreen-toggle-button"
import { useFullScreenToggle } from "@/lib/hooks/use-fullscreen-toggle"
import { useStockMovementRows, useApproveStockMovement, useRejectStockMovement } from "@/lib/hooks/use-inventory"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"

// Admin approval queue for pending stock movements — a row only ever gets
// created here when a technician completes a schedule job and records the
// filter items used on it (see the ct_filter_change_collection_inventory_link
// migration's handle_schedule_job_filter_item() trigger); a manual Stock
// Movement entry from Inventory > In & Out is approved immediately and never
// shows up here. Same dashboard badge-plus-dialog shape as
// DispatchApprovalQueue, deliberately much simpler internally — approving a
// stock movement is one mutation with no notification/conflict logic to
// manage, unlike a dispatch approval.
export function StockMovementApprovalQueue({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const { data: movements = [] } = useStockMovementRows()
  const approve = useApproveStockMovement()
  const reject = useRejectStockMovement()
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const { isFullScreen, exit: exitFullScreen, toggle: toggleFullScreen } = useFullScreenToggle()
  // Never reopen already full-screen from a previous session — this
  // component stays mounted across open/close (only `open` toggles
  // visibility), so without this the state would otherwise just persist.
  React.useEffect(() => {
    if (!open) exitFullScreen()
  }, [open, exitFullScreen])

  const items = React.useMemo(
    () => movements.filter((m) => m.status === "pending").sort((a, b) => a.date.localeCompare(b.date)),
    [movements]
  )

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // The plain (unprefixed) max-w-none alone isn't enough to actually
        // go full-width above the sm: breakpoint — cn()'s tailwind-merge
        // only dedupes classes within the same variant, so it leaves
        // sm:max-w-lg below untouched at that size (confirmed by literally
        // running twMerge() against these exact two class strings before
        // settling on this fix). sm:max-w-none is what actually clears it.
        className={cn(
          isFullScreen
            ? "inset-0 top-0 left-0 h-screen max-h-screen w-screen max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-none p-6"
            : "sm:max-w-lg max-h-[85vh]",
          "overflow-y-auto"
        )}
        // Radix's own Escape-to-close would otherwise close the whole
        // dialog while full-screen — intercept it here so Escape exits
        // full-screen first instead (matches the Minimize2 button's own
        // behavior).
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 font-normal"
                onClick={() => setHistoryOpen(true)}
              >
                <History className="h-3.5 w-3.5" /> {t("historyButton")}
              </Button>
            </div>
          </DialogTitle>
          <DialogDescription>{t("pendingApprovalDescription")}</DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">{t("nothingPendingApproval")}</p>
        ) : (
          <div className="space-y-3">
            {items.map((m) => (
              <div key={m.id} className="rounded-md border p-3 flex items-center justify-between gap-3">
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
                  {/* Nothing creates a pending addition today (see the CP
                      System investigation this app has already been
                      through) — kept here anyway so this queue stays
                      correct if that ever changes, rather than silently
                      hiding an addition. */}
                  {m.quantityAdded > 0 && <span className="text-sm font-medium text-success">+{m.quantityAdded}</span>}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={reject.isPending || approve.isPending || !user}
                    onClick={() => user && reject.mutate({ id: m.id, rejectedBy: user.id })}
                  >
                    <X className="h-3.5 w-3.5" /> {tCommon("reject")}
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={approve.isPending || reject.isPending || !user}
                    onClick={() => user && approve.mutate({ id: m.id, approvedBy: user.id })}
                  >
                    <Check className="h-3.5 w-3.5" /> {tCommon("approve")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>

    <StockMovementHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  )
}
