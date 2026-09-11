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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusBadge, type BadgeTone } from "@/components/shared/status-badge"
import type { PendingApprovalRow } from "@/components/schedule/pending-approvals-panel"
import {
  useApproveDispatchItem,
  useAcceptRequestedReschedule,
  useRejectDispatchItem,
  useRequestRescheduleByAdmin,
} from "@/lib/hooks/use-dispatch-confirmation"
import { useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useUpdateCollection } from "@/lib/hooks/use-collections"
import { useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { TECHNICIANS } from "@/lib/constants"
import { formatDate, formatDateTime } from "@/lib/utils"

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5 wrap-break-word">{value}</p>
    </div>
  )
}

// Radix Select forbids an empty-string item value, so "Not Assigned" needs
// its own sentinel — mapped back to "" (the plan's own serviceman/th
// columns are `not null default ''`, never a real NULL) on save. Same
// pattern schedule-form-dialog.tsx's own optional-technician Selects
// already use. "N/A" (the roster's own placeholder, used elsewhere for
// scoring/scheduling purposes — see smart-schedule.ts) is deliberately
// excluded from this list in favor of this explicit option, so this
// plan-level field's "nobody assigned yet" state is never confused with
// that separate roster concept.
const TECHNICIAN_NONE_SENTINEL = "__none__"
const TECHNICIAN_OPTIONS: string[] = TECHNICIANS.filter((t) => t !== "N/A")

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
  const { t: tFields } = useTranslation("fields")
  const { t: tCommon } = useTranslation("common")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const approve = useApproveDispatchItem()
  const acceptReschedule = useAcceptRequestedReschedule()
  const reject = useRejectDispatchItem()
  const requestReschedule = useRequestRescheduleByAdmin()
  const updateFilterChangePlan = useUpdateFilterChangePlan()
  const updateInstallPlan = useUpdateInstallPlan()
  const updateCollection = useUpdateCollection()
  const updateRepairPlan = useUpdateRepairPlan()

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

  // Editable task-detail fields — which of these actually apply depends on
  // row.entityType (see the conditional rendering below and
  // saveEditedFields): all four modules now have a plan-level technician
  // column (serviceman on filter_change_plans/collections/install_plans,
  // th on repair_plans — see the 20260914000000 migration), only
  // filter_change_plans/install_plans/collections have `note`, and filter/
  // collection "details" are naturally module-specific.
  const [servicemanValue, setServicemanValue] = React.useState(row?.servicemanField ?? "")
  const [dateValue, setDateValue] = React.useState(row?.scheduledDate ?? "")
  const [noteValue, setNoteValue] = React.useState(row?.planNote ?? "")
  const [filterTypeValue, setFilterTypeValue] = React.useState(row?.filterDetails?.filterType ?? "")
  const [productNoValue, setProductNoValue] = React.useState(row?.filterDetails?.productNo ?? "")
  const [scValue, setScValue] = React.useState(row?.filterDetails?.sc ?? "")
  const [amountValue, setAmountValue] = React.useState(
    row?.collectionDetails?.amount != null ? String(row.collectionDetails.amount) : ""
  )
  const [ctValue, setCtValue] = React.useState(row?.collectionDetails?.ct ?? "")

  const savingFields =
    updateFilterChangePlan.isPending || updateInstallPlan.isPending || updateCollection.isPending || updateRepairPlan.isPending
  const busy = approve.isPending || acceptReschedule.isPending || reject.isPending || requestReschedule.isPending || savingFields

  // Persists whatever the admin edited directly onto the plan's own row,
  // via each module's existing update mutation — approve_dispatch_item()
  // itself has no parameters for any of these, so this always runs as a
  // separate call, immediately before the approve/accept-reschedule call
  // below. Editing `pre_d` here is safe regardless of the row's starting
  // status: reset_dispatch_status_on_pre_d_change() only reacts when the
  // OLD status was already 'Pending Customer Confirmation'/'Reschedule
  // Requested' (bouncing it to Draft) — for a still-Draft row it's a no-op,
  // and even for a Reschedule Requested row bounced to Draft, the very next
  // call below (approve or accept) takes it straight back out of Draft.
  async function saveEditedFields() {
    if (!row) return
    if (row.entityType === "filter_change_plans") {
      await updateFilterChangePlan.mutateAsync({
        id: row.entityId,
        input: { preD: dateValue, serviceman: servicemanValue, note: noteValue, filterType: filterTypeValue, productNo: productNoValue, sc: scValue },
      })
    } else if (row.entityType === "install_plans") {
      await updateInstallPlan.mutateAsync({
        id: row.entityId,
        input: { preInstalledDate: dateValue, note: noteValue, serviceman: servicemanValue },
      })
    } else if (row.entityType === "collections") {
      await updateCollection.mutateAsync({
        id: row.entityId,
        input: { preD: dateValue, note: noteValue, amount: Number(amountValue) || 0, ct: ctValue, serviceman: servicemanValue },
      })
    } else if (row.entityType === "repair_plans") {
      await updateRepairPlan.mutateAsync({ id: row.entityId, input: { preD: dateValue, th: servicemanValue } })
    }
  }

  // Already approved and sent — nothing left for the admin to approve, and
  // editing task fields here would silently bounce it back to Draft via
  // reset_dispatch_status_on_pre_d_change() the moment pre_d changed
  // without any corresponding action to move it forward again. Reject and
  // an admin-initiated Request Reschedule both remain genuinely valid RPC
  // transitions from this status (see request_reschedule_by_admin's own
  // guard), so those two stay available — only the edit/Approve UI hides.
  const isAwaitingCustomer = row?.dispatchStatus === "Pending Customer Confirmation"

  async function handleApprove() {
    if (!row) return
    await saveEditedFields()
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

  // Same "Pending Approval"/"Approved" labeling as the table row's own
  // PendingStatusBadge (pending-approvals-panel.tsx) — Draft and Reschedule
  // Requested read as identical text here too, so the badge in this dialog
  // never disagrees with the one the admin just clicked "Review" from.
  const statusTone: BadgeTone = isAwaitingCustomer ? "success" : "warning"
  const statusLabel = isAwaitingCustomer ? t("approvedStatus") : t("pendingApprovalStatus")

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
                {isAwaitingCustomer ? (
                  <Field label={t("requestedDateLabel")} value={formatDate(dateValue)} />
                ) : (
                  <div>
                    <Label htmlFor="approval-scheduled-date" className="text-xs font-medium text-muted-foreground">
                      {t("requestedDateLabel")}
                    </Label>
                    <Input
                      id="approval-scheduled-date"
                      type="date"
                      className="mt-0.5 h-8"
                      value={dateValue}
                      onChange={(e) => setDateValue(e.target.value)}
                    />
                  </div>
                )}
                <Field label={t("requestedTimeLabel")} value={row.requestedTime || "—"} />
                {isAwaitingCustomer ? (
                  <Field label={t("technicianColumn")} value={servicemanValue || t("notAssigned")} />
                ) : (
                  <div>
                    <Label htmlFor="approval-technician" className="text-xs font-medium text-muted-foreground">
                      {t("technicianColumn")}
                    </Label>
                    <Select
                      value={servicemanValue || TECHNICIAN_NONE_SENTINEL}
                      onValueChange={(v) => setServicemanValue(v === TECHNICIAN_NONE_SENTINEL ? "" : v)}
                    >
                      <SelectTrigger id="approval-technician" className="mt-0.5 h-8 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TECHNICIAN_NONE_SENTINEL}>{t("notAssigned")}</SelectItem>
                        {/* A value already on the record that isn't one of the
                            known roster names (e.g. typed in before this was a
                            dropdown, or someone no longer on the roster) still
                            gets its own option — never silently hidden just
                            because it doesn't match the current TECHNICIANS list. */}
                        {servicemanValue && !TECHNICIAN_OPTIONS.includes(servicemanValue) && (
                          <SelectItem value={servicemanValue}>{servicemanValue}</SelectItem>
                        )}
                        {TECHNICIAN_OPTIONS.map((tech) => (
                          <SelectItem key={tech} value={tech}>
                            {tech}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Field label={t("routeColumn")} value={row.routeSequence != null ? String(row.routeSequence) : t("notAssigned")} />
                <Field label={t("requestDateTimeLabel")} value={formatDateTime(row.createdAt)} />
              </div>

              {row.planNote !== undefined && isAwaitingCustomer ? (
                <Field label={t("notesLabel")} value={noteValue || "—"} />
              ) : row.planNote !== undefined ? (
                <div className="space-y-1">
                  <Label htmlFor="approval-notes" className="text-xs font-medium text-muted-foreground">
                    {t("notesLabel")}
                  </Label>
                  <Textarea id="approval-notes" rows={2} value={noteValue} onChange={(e) => setNoteValue(e.target.value)} />
                </div>
              ) : (
                row.notes && <Field label={t("notesLabel")} value={row.notes} />
              )}
              <Field label={t("remarksLabel")} value={row.remarks || "—"} />
              {row.rescheduleReason && <Field label={t("rescheduleReasonLabel")} value={row.rescheduleReason} />}

              {row.filterDetails && isAwaitingCustomer ? (
                <div className="space-y-1.5 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("filterDetailsLabel")}</p>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <span>{filterTypeValue || "—"}</span>
                    <span>{productNoValue || "—"}</span>
                    <span>{scValue || "—"}</span>
                  </div>
                </div>
              ) : (
                row.filterDetails && (
                  <div className="space-y-1.5 rounded-md border p-3">
                    <p className="text-xs font-medium text-muted-foreground">{t("filterDetailsLabel")}</p>
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        value={filterTypeValue}
                        onChange={(e) => setFilterTypeValue(e.target.value)}
                        placeholder={tFields("filter")}
                        className="h-8"
                      />
                      <Input
                        value={productNoValue}
                        onChange={(e) => setProductNoValue(e.target.value)}
                        placeholder={tFields("productNo")}
                        className="h-8"
                      />
                      <Input value={scValue} onChange={(e) => setScValue(e.target.value)} placeholder={tFields("sc")} className="h-8" />
                    </div>
                  </div>
                )
              )}
              {row.collectionDetails && isAwaitingCustomer ? (
                <div className="space-y-1.5 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("collectionDetailsLabel")}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span>{amountValue || "—"}</span>
                    <span>{ctValue || "—"}</span>
                  </div>
                </div>
              ) : (
                row.collectionDetails && (
                <div className="space-y-1.5 rounded-md border p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("collectionDetailsLabel")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="number"
                      value={amountValue}
                      onChange={(e) => setAmountValue(e.target.value)}
                      placeholder={tFields("amount")}
                      className="h-8"
                    />
                    <Input value={ctValue} onChange={(e) => setCtValue(e.target.value)} placeholder={tFields("ct")} className="h-8" />
                  </div>
                </div>
                )
              )}
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
              {isAwaitingCustomer && <p className="text-xs text-muted-foreground">{t("awaitingCustomerResponse")}</p>}
            </div>
          )}
          {isAdmin && (
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="text-danger hover:text-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
                  {t("reject")}
                </Button>
                {(row?.dispatchStatus === "Draft" || isAwaitingCustomer) && (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setRescheduleOpen(true)}>
                    {t("requestReschedule")}
                  </Button>
                )}
              </div>
              {!isAwaitingCustomer && (
                <Button
                  type="button"
                  disabled={busy || (row?.dispatchStatus === "Draft" && !notifyEmail.trim())}
                  onClick={handleApprove}
                >
                  {busy ? tCommon("saving") : row?.dispatchStatus === "Draft" ? t("approveAndSendConfirmation") : t("approveAndSchedule")}
                </Button>
              )}
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
