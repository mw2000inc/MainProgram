"use client"

import * as React from "react"
import { Send, CheckCheck, CheckCircle2, TriangleAlert, CalendarClock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers, useUpdateCustomer } from "@/lib/hooks/use-customers"
import { useApproveDispatchItem, useAcceptRequestedReschedule } from "@/lib/hooks/use-dispatch-confirmation"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { DispatchEntityType, DispatchChannelResult } from "@/lib/api/dispatch-confirmation"
import type { Customer, DispatchStatus } from "@/lib/types"

// Every dispatch row this queue cares about, across all four modules,
// regardless of its current dispatchStatus — Draft ones are what actually
// render in the list below; every status is kept around so
// findConflicts() (see its own comment) can check a candidate against
// Confirmed/Pending/other-Draft rows too, not just its own module's Draft
// list.
interface DispatchRow {
  entityType: DispatchEntityType
  entityId: string
  moduleLabel: string
  recordLabel: string
  scheduledDate: string
  dispatchStatus?: DispatchStatus
  // Whichever of these a row actually has — see each module's own gap
  // (Installation/Repair have no customerId; Repair has no phone/email
  // link at all). isSameCustomer() falls through these in priority order.
  customerId?: string
  orderNumber?: string
  phone?: string
  email?: string
  // Only meaningful when dispatchStatus is 'Reschedule Requested' — the
  // customer's own proposed replacement date/time, collected on the
  // confirm page (see dispatch-confirmation-view.tsx). requestedTime is a
  // courtesy display detail only, never applied to the real schedule.
  requestedDate?: string
  requestedTime?: string
}

// Best-effort customer lookup for prefilling a phone/email default — tries
// an explicit customerId link first (Filter Change, Collections), falling
// back to the shared order-number match (see customer-lookup.ts) for the
// modules that don't carry a customerId at all (Installation).
function findCustomer(customers: Customer[], { customerId, orderNumber }: { customerId?: string; orderNumber?: string }) {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId)
    if (byId) return byId
  }
  if (orderNumber) return findCustomerByOrderNumber(customers, orderNumber)
  return undefined
}

// Same customer, by whichever identifying signal both sides actually
// have — checked in priority order (only falls through to the next signal
// when the higher one is missing on either side, not when it's present
// but different) since customerId/orderNumber are structural identity and
// far more reliable than a phone/email string match.
function isSameCustomer(a: DispatchRow, b: { customerId?: string; orderNumber?: string; phone?: string; email?: string }): boolean {
  if (a.customerId && b.customerId) return a.customerId === b.customerId
  if (a.orderNumber && b.orderNumber) return a.orderNumber === b.orderNumber
  if (a.phone && b.phone && a.phone.trim() === b.phone.trim()) return true
  if (a.email && b.email && a.email.trim().toLowerCase() === b.email.trim().toLowerCase()) return true
  return false
}

// Reschedule Requested is included too — a customer already mid-
// negotiation on one item (declined a date, possibly proposed another) is
// exactly the kind of "existing schedule" this check exists to surface
// before a second notification goes out for something else.
const CONFLICT_STATUSES: DispatchStatus[] = ["Confirmed", "Pending Customer Confirmation", "Draft", "Reschedule Requested"]

// Same mapping as DispatchStatusCell in daily-report-section.tsx — kept as
// its own small copy here rather than a shared import, to avoid a
// cross-import between these two otherwise-independent panel files.
const DISPATCH_STATUS_KEYS: Record<string, string> = {
  Draft: "draft",
  "Pending Customer Confirmation": "pendingCustomerConfirmation",
  Confirmed: "confirmed",
  "Reschedule Requested": "rescheduleRequested",
}

// Admin approval queue for newly-scheduled Filter Change/Installation/
// Collection/Repair dispatches (see the dispatch_confirmation_workflow and
// dispatch_dual_channel_notifications migrations) — only rows created via
// each module's own "Add" form start here at dispatchStatus='Draft';
// auto-generated recurring-schedule/C/T-completion rows skip this queue
// entirely (see the migration's own comment for why). Approving here
// always attempts BOTH a real SMS (Semaphore) and a real email (Resend)
// to whichever of phone/email is filled in — either can be left blank to
// skip that channel entirely, but at least one is required.
//
// Before actually sending, Approve first checks whether the same customer
// already has another Confirmed/Pending/Draft item anywhere across all
// four modules (a second notification going out before they've answered
// the first, an accidental duplicate schedule, or a duplicate Draft an
// admin didn't realize already existed) — client-side only, since this is
// an internal admin tool and every module's full list is already loaded
// here anyway. Finding nothing lets Approve send immediately, exactly as
// before; finding something opens a confirmation dialog listing what was
// found, and only proceeds on an explicit "Send Anyway".
export function DispatchApprovalQueue({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: customers = [] } = useCustomers()
  const approve = useApproveDispatchItem()
  const acceptReschedule = useAcceptRequestedReschedule()
  const updateCustomer = useUpdateCustomer()

  const [phoneDrafts, setPhoneDrafts] = React.useState<Record<string, string>>({})
  const [emailDrafts, setEmailDrafts] = React.useState<Record<string, string>>({})
  const [lastResult, setLastResult] = React.useState<{ confirmUrl: string; sms?: DispatchChannelResult; email?: DispatchChannelResult } | null>(null)
  const [pendingApproval, setPendingApproval] = React.useState<{
    item: DispatchRow
    notifyPhone: string
    notifyEmail: string
    conflicts: DispatchRow[]
  } | null>(null)
  const [bulkApproving, setBulkApproving] = React.useState(false)
  const [bulkSummary, setBulkSummary] = React.useState<{
    approved: DispatchRow[]
    skippedNoContact: DispatchRow[]
    skippedConflict: { item: DispatchRow; conflicts: DispatchRow[] }[]
  } | null>(null)

  const allRows: DispatchRow[] = React.useMemo(() => {
    const list: DispatchRow[] = []
    for (const p of filterChangePlans) {
      const customer = findCustomer(customers, { customerId: p.customerId, orderNumber: p.orderNumber })
      list.push({
        entityType: "filter_change_plans",
        entityId: p.id,
        moduleLabel: "filterChangeModule",
        recordLabel: p.memberAccount || p.orderNumber,
        scheduledDate: p.preD || p.planDate,
        dispatchStatus: p.dispatchStatus,
        customerId: p.customerId,
        orderNumber: p.orderNumber,
        phone: p.contactNumber || undefined,
        email: customer?.email,
        requestedDate: p.requestedDate,
        requestedTime: p.requestedTime,
      })
    }
    for (const p of installPlans) {
      const customer = findCustomer(customers, { orderNumber: p.orderNo })
      list.push({
        entityType: "install_plans",
        entityId: p.id,
        moduleLabel: "installationModule",
        recordLabel: p.name || p.orderNo,
        scheduledDate: p.preInstalledDate || p.inputDate,
        dispatchStatus: p.dispatchStatus,
        // install_plans has no real customer_id column (see the
        // auto_create_schedule_job_on_confirm migration's own note) — this
        // is purely the in-memory result of the orderNumber match above,
        // used here only as the write-back target for a corrected
        // phone/email (see doApprove), never persisted onto the plan row.
        customerId: customer?.id,
        orderNumber: p.orderNo,
        phone: p.contactNumber || undefined,
        email: customer?.email,
        requestedDate: p.requestedDate,
        requestedTime: p.requestedTime,
      })
    }
    for (const c of collections) {
      const customer = findCustomer(customers, { customerId: c.customerId, orderNumber: c.orderNo })
      list.push({
        entityType: "collections",
        entityId: c.id,
        moduleLabel: "collectionModule",
        recordLabel: c.accountName || c.orderNo,
        scheduledDate: c.preD || c.collectionDate,
        dispatchStatus: c.dispatchStatus,
        customerId: c.customerId,
        orderNumber: c.orderNo,
        phone: customer?.contactNumber,
        email: customer?.email,
        requestedDate: c.requestedDate,
        requestedTime: c.requestedTime,
      })
    }
    for (const r of repairPlans) {
      // repair_plans has no phone/email/customer_id column of its own — the
      // orderNumber match below (same fallback Installation already uses)
      // is the only way to resolve a real customer for it at all, both for
      // prefilling phone/email here and as the write-back target below.
      const customer = findCustomer(customers, { orderNumber: r.orderNo })
      list.push({
        entityType: "repair_plans",
        entityId: r.id,
        moduleLabel: "repairModule",
        recordLabel: r.accountName || r.orderNo,
        scheduledDate: r.preD || r.issuedDate,
        dispatchStatus: r.dispatchStatus,
        customerId: customer?.id,
        orderNumber: r.orderNo,
        phone: customer?.contactNumber,
        email: customer?.email,
        requestedDate: r.requestedDate,
        requestedTime: r.requestedTime,
      })
    }
    return list
  }, [filterChangePlans, installPlans, collections, repairPlans, customers])

  const items = React.useMemo(
    () => allRows.filter((r) => r.dispatchStatus === "Draft").sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [allRows]
  )
  // A decline with no alternate date has nothing for Accept to do — the
  // admin's only path there is editing Pre D directly (see the
  // reset_dispatch_on_pre_d_edit trigger's own extension to cover this
  // status). Still shown here for visibility, just without an Accept
  // button.
  const rescheduleRequests = React.useMemo(
    () => allRows.filter((r) => r.dispatchStatus === "Reschedule Requested").sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
    [allRows]
  )

  function phoneFor(item: DispatchRow) {
    return phoneDrafts[item.entityId] ?? item.phone ?? ""
  }
  function emailFor(item: DispatchRow) {
    return emailDrafts[item.entityId] ?? item.email ?? ""
  }

  // Every other Confirmed/Pending Customer Confirmation/Draft row (any
  // module) that looks like the same customer as `item` — using the
  // phone/email actually typed into this queue (not just item's own
  // default), since that's the most current signal for who this
  // notification is really going to.
  function findConflicts(item: DispatchRow, typedPhone: string, typedEmail: string): DispatchRow[] {
    const candidate = { customerId: item.customerId, orderNumber: item.orderNumber, phone: typedPhone, email: typedEmail }
    return allRows.filter(
      (r) =>
        !(r.entityType === item.entityType && r.entityId === item.entityId) &&
        r.dispatchStatus &&
        CONFLICT_STATUSES.includes(r.dispatchStatus) &&
        isSameCustomer(r, candidate)
    )
  }

  // A phone/email typed here otherwise only ever lands on this one dispatch
  // row's notify_phone/notify_email — the next dispatch for the same
  // customer would start blank again. Whenever this item resolved to a real
  // customer (customerId — see allRows above, filled in for every module
  // now), and the typed value differs from what's on that customer's
  // permanent record, save it back too. Deliberately one-directional and
  // additive-only: an empty typed value never clears/overwrites anything on
  // the customer record, it just means that channel isn't sent this time.
  function saveContactToCustomer(item: DispatchRow, notifyPhone: string, notifyEmail: string) {
    if (!item.customerId) return
    const customer = customers.find((c) => c.id === item.customerId)
    if (!customer) return
    const patch: { email?: string; contactNumber?: string } = {}
    if (notifyEmail && notifyEmail !== (customer.email ?? "")) patch.email = notifyEmail
    if (notifyPhone && notifyPhone !== (customer.contactNumber ?? "")) patch.contactNumber = notifyPhone
    if (Object.keys(patch).length > 0) {
      updateCustomer.mutate({ id: customer.id, input: patch })
    }
  }

  async function doApprove(item: DispatchRow, notifyPhone: string, notifyEmail: string) {
    const result = await approve.mutateAsync({
      entityType: item.entityType,
      entityId: item.entityId,
      notifyPhone: notifyPhone || undefined,
      notifyEmail: notifyEmail || undefined,
    })
    if (!result) return
    setLastResult(result)
    saveContactToCustomer(item, notifyPhone, notifyEmail)
  }

  function handleApproveClick(item: DispatchRow) {
    const notifyPhone = phoneFor(item).trim()
    const notifyEmail = emailFor(item).trim()
    if (!notifyPhone && !notifyEmail) return
    const conflicts = findConflicts(item, notifyPhone, notifyEmail)
    if (conflicts.length > 0) {
      setPendingApproval({ item, notifyPhone, notifyEmail, conflicts })
      return
    }
    doApprove(item, notifyPhone, notifyEmail)
  }

  function handleSendAnyway() {
    if (!pendingApproval) return
    const { item, notifyPhone, notifyEmail } = pendingApproval
    setPendingApproval(null)
    doApprove(item, notifyPhone, notifyEmail)
  }

  // A conflict blocks only the one item it's found on, never the whole
  // batch — an admin approving 5 clean items shouldn't have all 5 held up
  // because one of them happens to share a customer with something
  // already scheduled. Whatever gets skipped is listed afterward (see
  // bulkSummary below) for the admin to review and approve individually —
  // that path still shows the normal interactive conflict dialog, this
  // one never does (asking "send anyway?" once per conflict would defeat
  // the point of a bulk action).
  async function handleApproveAll() {
    setBulkApproving(true)
    setBulkSummary(null)
    const approved: DispatchRow[] = []
    const skippedNoContact: DispatchRow[] = []
    const skippedConflict: { item: DispatchRow; conflicts: DispatchRow[] }[] = []
    // Snapshot now — `items` itself shrinks as each approval succeeds
    // (a Draft leaving the list once it's Pending Customer Confirmation),
    // so iterating the live memo would skip whatever's left after the
    // first successful approval re-renders this component.
    for (const item of [...items]) {
      const notifyPhone = phoneFor(item).trim()
      const notifyEmail = emailFor(item).trim()
      if (!notifyPhone && !notifyEmail) {
        skippedNoContact.push(item)
        continue
      }
      const candidate = { customerId: item.customerId, orderNumber: item.orderNumber, phone: notifyPhone, email: notifyEmail }
      // allRows (and therefore findConflicts) won't reflect an approval
      // that just happened earlier in *this* loop — the query cache only
      // updates once its invalidated queries actually refetch, which
      // doesn't happen synchronously inside this loop — so a same-batch
      // duplicate is checked separately against what's already been
      // approved so far this run.
      const conflicts = [...findConflicts(item, notifyPhone, notifyEmail), ...approved.filter((a) => isSameCustomer(a, candidate))]
      if (conflicts.length > 0) {
        skippedConflict.push({ item, conflicts })
        continue
      }
      await doApprove(item, notifyPhone, notifyEmail)
      approved.push(item)
    }
    setBulkSummary({ approved, skippedNoContact, skippedConflict })
    setBulkApproving(false)
  }

  // Jumps straight to Confirmed and sends a "you're confirmed" notification
  // — no interactive conflict dialog here even though Reschedule Requested
  // is now in CONFLICT_STATUSES above, since accepting isn't creating a
  // new notification the admin is choosing to send; it's finalizing one
  // the customer already asked for. A genuine duplicate against this exact
  // customer would already have been caught back when the *original* item
  // was approved.
  async function handleAcceptReschedule(item: DispatchRow) {
    await acceptReschedule.mutateAsync({ entityType: item.entityType, entityId: item.entityId })
  }

  function channelBadge(result: DispatchChannelResult | undefined, channel: "sms" | "email") {
    if (!result) return null
    const tone = result.status === "sent" ? "success" : result.status === "failed" ? "danger" : "neutral"
    const key = `${channel}${result.status === "sent" ? "Sent" : result.status === "failed" ? "Failed" : "Skipped"}`
    return <StatusBadge tone={tone} label={t(key)} />
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span>{t("title")}</span>
              {items.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 font-normal"
                  disabled={bulkApproving || approve.isPending}
                  onClick={handleApproveAll}
                >
                  <CheckCheck className="h-3.5 w-3.5" /> {bulkApproving ? t("approving") : t("approveAllCount", { count: items.length })}
                </Button>
              )}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          {lastResult && (
            <div className="rounded-md border bg-muted/50 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {channelBadge(lastResult.sms, "sms")}
                {channelBadge(lastResult.email, "email")}
              </div>
              <p className="text-muted-foreground">
                {t("confirmationLink")} <span className="break-all font-mono">{lastResult.confirmUrl}</span>
              </p>
            </div>
          )}

          {bulkSummary && (
            <div className="rounded-md border bg-muted/50 p-3 text-xs space-y-2">
              <p className="font-medium">
                {t("approveAllFinishedSent", { count: bulkSummary.approved.length })}
                {bulkSummary.skippedConflict.length > 0 && t("skippedPossibleDuplicate", { count: bulkSummary.skippedConflict.length })}
                {bulkSummary.skippedNoContact.length > 0 && t("skippedNoContactEntered", { count: bulkSummary.skippedNoContact.length })}
              </p>
              {bulkSummary.skippedConflict.length > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground">{t("skippedDuplicateReviewNote")}</p>
                  {bulkSummary.skippedConflict.map(({ item, conflicts }) => (
                    <p key={`${item.entityType}-${item.entityId}`}>
                      {t(item.moduleLabel)} — {item.recordLabel}{" "}
                      {conflicts.length === 1
                        ? t("matchesOtherItem", { count: conflicts.length })
                        : t("matchesOtherItems", { count: conflicts.length })}
                    </p>
                  ))}
                </div>
              )}
              {bulkSummary.skippedNoContact.length > 0 && (
                <div className="space-y-1">
                  <p className="text-muted-foreground">{t("skippedNoPhoneOrEmail")}</p>
                  {bulkSummary.skippedNoContact.map((item) => (
                    <p key={`${item.entityType}-${item.entityId}`}>
                      {t(item.moduleLabel)} — {item.recordLabel}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {items.length === 0 && rescheduleRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{t("nothingWaiting")}</p>
          ) : items.length === 0 ? null : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={`${item.entityType}-${item.entityId}`} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="secondary" label={t(item.moduleLabel)} />
                        <span className="font-medium truncate">{item.recordLabel}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("scheduled", { date: formatDate(item.scheduledDate) })}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex-1 min-w-[160px] space-y-1">
                      <Label className="text-xs text-muted-foreground">{t("phone")}</Label>
                      <Input
                        className="h-8"
                        placeholder={t("phoneNumberSms")}
                        value={phoneFor(item)}
                        onChange={(e) => setPhoneDrafts((prev) => ({ ...prev, [item.entityId]: e.target.value }))}
                      />
                    </div>
                    <div className="flex-1 min-w-[200px] space-y-1">
                      <Label className="text-xs text-muted-foreground">{t("email")}</Label>
                      <Input
                        className="h-8"
                        placeholder={t("emailAddress")}
                        value={emailFor(item)}
                        onChange={(e) => setEmailDrafts((prev) => ({ ...prev, [item.entityId]: e.target.value }))}
                      />
                    </div>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={(!phoneFor(item).trim() && !emailFor(item).trim()) || approve.isPending || bulkApproving}
                      onClick={() => handleApproveClick(item)}
                    >
                      <Send className="h-3.5 w-3.5" /> {tCommon("approve")}
                    </Button>
                  </div>
                  {item.customerId && (
                    <p className="text-xs text-muted-foreground">{t("contactSavesToCustomer")}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {rescheduleRequests.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-t pt-4">
                <CalendarClock className="h-4 w-4 text-warning" />
                <h3 className="text-sm font-medium">{t("rescheduleRequestsCount", { count: rescheduleRequests.length })}</h3>
              </div>
              <p className="text-xs text-muted-foreground">{t("rescheduleRequestsDescription")}</p>
              {rescheduleRequests.map((item) => (
                <div key={`${item.entityType}-${item.entityId}`} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="secondary" label={t(item.moduleLabel)} />
                        <span className="font-medium truncate">{item.recordLabel}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("originallyScheduled", { date: formatDate(item.scheduledDate) })}</p>
                    </div>
                    {item.requestedDate ? (
                      <Button
                        size="sm"
                        className="h-8 gap-1.5 shrink-0"
                        disabled={acceptReschedule.isPending}
                        onClick={() => handleAcceptReschedule(item)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("accept")}
                      </Button>
                    ) : null}
                  </div>
                  {item.requestedDate ? (
                    <div className="rounded-md border bg-warning/5 p-2 text-xs">
                      {t("customerRequested")} <span className="font-medium">{formatDate(item.requestedDate)}</span>
                      {item.requestedTime && <span className="font-medium"> {t("at")} {item.requestedTime}</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t("noAlternateDate")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingApproval} onOpenChange={(next) => !next && setPendingApproval(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-warning" /> {t("possibleDuplicateOrConflict")}
            </DialogTitle>
            <DialogDescription>
              {pendingApproval?.conflicts.length === 1 ? t("conflictDescriptionSingle") : t("conflictDescriptionMultiple")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pendingApproval?.conflicts.map((c) => (
              <div key={`${c.entityType}-${c.entityId}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge tone="secondary" label={t(c.moduleLabel)} />
                  <span className="truncate">{c.recordLabel}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                  <span>{formatDate(c.scheduledDate)}</span>
                  <StatusBadge
                    tone={c.dispatchStatus === "Confirmed" ? "success" : c.dispatchStatus === "Draft" ? "neutral" : "warning"}
                    label={c.dispatchStatus ? t(DISPATCH_STATUS_KEYS[c.dispatchStatus] ?? c.dispatchStatus) : t("unknown")}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPendingApproval(null)}>
              {tCommon("cancel")}
            </Button>
            <Button className="gap-1.5" disabled={approve.isPending} onClick={handleSendAnyway}>
              <Send className="h-3.5 w-3.5" /> {t("sendAnyway")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
