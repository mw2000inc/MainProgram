"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import type { PendingApprovalRow } from "@/components/schedule/pending-approvals-panel"
import {
  useApproveDispatchItem,
  useAcceptRequestedReschedule,
  useRejectDispatchItem,
  useRequestRescheduleByAdmin,
} from "@/lib/hooks/use-dispatch-confirmation"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, formatDateTime } from "@/lib/utils"

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5 wrap-break-word">{value}</p>
    </div>
  )
}

// The single-item Review flow for the Schedule page's Pending Approvals
// tab — Approve & Schedule / Reject / Request Reschedule, exactly the three
// actions asked for. Deliberately simpler than DispatchApprovalQueue's own
// bulk/conflict-detection UI (that stays exactly as it is, on the
// Dashboard) — this is a focused single-record reviewer, not a second copy
// of that panel.
export function ApprovalDetailDialog({
  row,
  onOpenChange,
}: {
  row: PendingApprovalRow | undefined
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const approve = useApproveDispatchItem()
  const acceptReschedule = useAcceptRequestedReschedule()
  const reject = useRejectDispatchItem()
  const requestReschedule = useRequestRescheduleByAdmin()

  // Initialized directly from `row` rather than synced via an effect — the
  // parent (PendingApprovalsPanel) remounts this component with a fresh
  // `key` per reviewed row (same pattern ScheduleAgenda's MarkJobDoneDialog
  // already uses), so this initial value is only ever read once per row,
  // exactly when it's needed.
  const [notifyEmail, setNotifyEmail] = React.useState(row?.customerEmail ?? "")
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectReason, setRejectReason] = React.useState("")
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false)
  const [rescheduleReason, setRescheduleReason] = React.useState("")

  const busy = approve.isPending || acceptReschedule.isPending || reject.isPending || requestReschedule.isPending

  async function handleApprove() {
    if (!row) return
    if (row.dispatchStatus === "Reschedule Requested") {
      // The customer already told us the date they want — this schedules
      // it immediately, no further customer action needed (see
      // accept_requested_reschedule's own comment).
      const result = await acceptReschedule.mutateAsync({ entityType: row.entityType, entityId: row.entityId })
      if (result) onOpenChange(false)
      return
    }
    // Draft: sends the customer a confirmation request — becomes Scheduled
    // once they confirm, same as DispatchApprovalQueue's own Approve.
    const email = notifyEmail.trim()
    if (!email) return
    const result = await approve.mutateAsync({ entityType: row.entityType, entityId: row.entityId, notifyEmail: email })
    if (result) onOpenChange(false)
  }

  async function handleConfirmReject() {
    if (!row) return
    const result = await reject.mutateAsync({ entityType: row.entityType, entityId: row.entityId, reason: rejectReason.trim() || undefined })
    if (result !== null) {
      setRejectOpen(false)
      setRejectReason("")
      onOpenChange(false)
    }
  }

  async function handleConfirmReschedule() {
    if (!row || !rescheduleReason.trim()) return
    const result = await requestReschedule.mutateAsync({ entityType: row.entityType, entityId: row.entityId, reason: rescheduleReason.trim() })
    if (result !== null) {
      setRescheduleOpen(false)
      setRescheduleReason("")
      onOpenChange(false)
    }
  }

  const statusTone: BadgeTone = row?.dispatchStatus === "Draft" ? "warning" : "warning"
  const statusLabel = row?.dispatchStatus === "Draft" ? t("pendingApprovalStatus") : t("rescheduleRequested")

  return (
    <>
      <Dialog open={!!row} onOpenChange={onOpenChange}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("scheduleRequestTitle")}</DialogTitle>
            <DialogDescription>{t("scheduleRequestDescription")}</DialogDescription>
          </DialogHeader>
          {row && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("orderNoColumn")} value={row.orderNumber || "—"} />
                <Field label={t("jobTypeColumn")} value={t(row.moduleKey)} />
                <Field label={t("customerColumn")} value={row.customerName || "—"} />
                <Field label={t("requestedDateLabel")} value={formatDate(row.scheduledDate)} />
                <Field label={t("requestedTimeLabel")} value={row.requestedTime || "—"} />
                <Field
                  label={t("technicianColumn")}
                  value={row.technician ? formatTechnicians(row.technician, row.technician2) : t("notAssigned")}
                />
                <Field label={t("routeColumn")} value={row.routeSequence != null ? String(row.routeSequence) : t("notAssigned")} />
                <Field label={t("requestDateTimeLabel")} value={formatDateTime(row.createdAt)} />
              </div>
              <Field label={t("notesLabel")} value={row.notes || "—"} />
              <Field label={t("remarksLabel")} value={row.remarks || "—"} />
              {row.rescheduleReason && <Field label={t("rescheduleReasonLabel")} value={row.rescheduleReason} />}
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t("statusColumn")}</p>
                <div className="mt-1">
                  <StatusBadge tone={statusTone} label={statusLabel} />
                </div>
              </div>

              {row.dispatchStatus === "Draft" && (
                <div className="space-y-1.5 rounded-md border p-3">
                  <Label htmlFor="approval-notify-email" className="text-xs">
                    {t("emailAddress")}
                  </Label>
                  <Input
                    id="approval-notify-email"
                    type="email"
                    value={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.value)}
                    placeholder="customer@example.com"
                  />
                  <p className="text-xs text-muted-foreground">{t("approveWillSendConfirmation")}</p>
                </div>
              )}
              {row.dispatchStatus === "Reschedule Requested" && (
                <p className="text-xs text-muted-foreground">{t("approveWillScheduleNow")}</p>
              )}
            </div>
          )}
          {isAdmin && (
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="text-danger hover:text-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
                  {t("reject")}
                </Button>
                {row?.dispatchStatus === "Draft" && (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setRescheduleOpen(true)}>
                    {t("requestReschedule")}
                  </Button>
                )}
              </div>
              <Button
                type="button"
                disabled={busy || (row?.dispatchStatus === "Draft" && !notifyEmail.trim())}
                onClick={handleApprove}
              >
                {busy ? tCommon("saving") : row?.dispatchStatus === "Draft" ? t("approveAndSendConfirmation") : t("approveAndSchedule")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("rejectDialogTitle")}</DialogTitle>
            <DialogDescription>{t("rejectDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">{t("rejectReasonLabel")}</Label>
            <Textarea id="reject-reason" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={reject.isPending}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              className="bg-danger text-white hover:bg-danger/90"
              disabled={reject.isPending}
              onClick={handleConfirmReject}
            >
              {reject.isPending ? tCommon("saving") : t("confirmRejection")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t("requestRescheduleDialogTitle")}</DialogTitle>
            <DialogDescription>{t("requestRescheduleDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-reason">{t("requestRescheduleMessageLabel")}</Label>
            <Textarea id="reschedule-reason" rows={3} value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRescheduleOpen(false)} disabled={requestReschedule.isPending}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" disabled={requestReschedule.isPending || !rescheduleReason.trim()} onClick={handleConfirmReschedule}>
              {requestReschedule.isPending ? tCommon("saving") : t("requestReschedule")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
