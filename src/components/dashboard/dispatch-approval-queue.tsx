"use client"

import * as React from "react"
import { parse, parseISO } from "date-fns"
import { ko } from "date-fns/locale"
import { Send, CheckCheck, CheckCircle2, TriangleAlert, CalendarClock, History } from "lucide-react"
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
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useApproveDispatchItem, useAcceptRequestedReschedule } from "@/lib/hooks/use-dispatch-confirmation"
import { DispatchHistoryDialog } from "@/components/dashboard/dispatch-history-dialog"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, safeFormat } from "@/lib/utils"
import type { DispatchEntityType, DispatchChannelResult } from "@/lib/api/dispatch-confirmation"
import type { Customer, DispatchStatus, SaleListEntry, Locale } from "@/lib/types"

// SMS was fully removed as a notification channel (email is the only one
// now) — see dispatch-notifications-server.ts's own note. This queue no
// longer collects or matches on a phone number at all; DispatchRow's old
// `phone` field, the phone input, and every bit of phone-specific state
// below it are gone. General phone number fields on customer/member
// records themselves (contactNumber, etc.) are untouched — this was
// scoped strictly to the dispatch-notification feature.

// The Reschedule Requests card's "customer requested" line is the one spot
// in this file rendering a date/time from data, not a translated string —
// item.requestedDate/requestedTime are a courtesy display detail only
// (see the DispatchRow interface's own comment above), never applied to
// the real schedule, so localizing them is scoped to exactly these two
// small helpers rather than touching the shared formatDate() used
// elsewhere in the app (86 other call sites, all of which keep rendering
// exactly as before).
//
// English keeps calling the shared formatDate() unchanged ("Sep 4, 2026");
// Korean uses date-fns's own ko locale directly for a properly Korean-
// ordered date ("2026년 9월 4일").
// The Korean branch calls date-fns' format() directly (for the { locale: ko }
// option formatDate() doesn't take) rather than through the shared
// formatDate() — so it needs its own guard against the same crash
// (date-fns throws on an Invalid Date rather than returning something) via
// safeFormat, same as formatDate() itself now does. dateStr comes straight
// from the customer's own typed/picked confirm-page date, so it can be
// anything a native <input type="date"> lets through.
function formatRequestedDate(dateStr: string, locale: Locale): string {
  if (locale === "ko") return safeFormat(parseISO(dateStr), "yyyy년 M월 d일", { locale: ko })
  return formatDate(dateStr)
}

// requestedTime is raw 24-hour "HH:mm" straight from the customer's native
// <input type="time"> on the confirm page — never parsed or reformatted
// before this. Turns it into a real 12-hour display: "2:00 PM" in English,
// "오후 2:00" in Korean (date-fns's own token order for ko already puts
// 오전/오후 before the number, which is the natural Korean word order).
// parse() itself never throws on a malformed timeStr (it just returns an
// Invalid Date), but format()-ing that result would — guarded the same way
// as every other format() call site now is, English branch included (this
// one was never actually safe just because the comment above only called
// out the Korean date branch).
function formatRequestedTime(timeStr: string, locale: Locale): string {
  const parsed = parse(timeStr, "HH:mm", new Date())
  return locale === "ko" ? safeFormat(parsed, "a h:mm", { locale: ko }) : safeFormat(parsed, "h:mm a")
}

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
  // (Installation/Repair have no customerId; Repair has no email link at
  // all). isSameCustomer() falls through these in priority order.
  customerId?: string
  orderNumber?: string
  email?: string
  // Only meaningful when dispatchStatus is 'Reschedule Requested' — the
  // customer's own proposed replacement date/time, collected on the
  // confirm page (see dispatch-confirmation-view.tsx). requestedTime is a
  // courtesy display detail only, never applied to the real schedule.
  requestedDate?: string
  requestedTime?: string
}

// Best-effort customer lookup for prefilling an email default — tries
// an explicit customerId link first (Filter Change, Collections), falling
// back to the shared order-number match (see customer-lookup.ts, which
// checks sale_list_entries — not customers.order_number, a completely
// different numbering scheme that never overlaps with what these modules'
// own order numbers actually look like) for the modules that don't carry a
// customerId at all (Installation, Repair).
function findCustomer(
  customers: Customer[],
  saleListEntries: SaleListEntry[],
  { customerId, orderNumber }: { customerId?: string; orderNumber?: string }
) {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId)
    if (byId) return byId
  }
  if (orderNumber) return findCustomerByOrderNumber(customers, saleListEntries, orderNumber)
  return undefined
}

// Same customer, by whichever identifying signal both sides actually
// have — checked in priority order (only falls through to the next signal
// when the higher one is missing on either side, not when it's present
// but different) since customerId/orderNumber are structural identity and
// far more reliable than an email string match.
function isSameCustomer(a: DispatchRow, b: { customerId?: string; orderNumber?: string; email?: string }): boolean {
  if (a.customerId && b.customerId) return a.customerId === b.customerId
  if (a.orderNumber && b.orderNumber) return a.orderNumber === b.orderNumber
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
// sends a real email (Resend) to whichever address is filled in — email
// is required. SMS (textbee) was fully removed as a notification channel;
// see dispatch-notifications-server.ts's own note.
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
  const { t, locale } = useTranslation("dispatch")
  const { t: tCommon } = useTranslation("common")
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const approve = useApproveDispatchItem()
  const acceptReschedule = useAcceptRequestedReschedule()
  const updateCustomer = useUpdateCustomer()
  const [historyOpen, setHistoryOpen] = React.useState(false)

  const [emailDrafts, setEmailDrafts] = React.useState<Record<string, string>>({})
  const [lastResult, setLastResult] = React.useState<{ confirmUrl: string; email?: DispatchChannelResult } | null>(null)
  const [pendingApproval, setPendingApproval] = React.useState<{
    item: DispatchRow
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
      const customer = findCustomer(customers, saleListEntries, { customerId: p.customerId, orderNumber: p.orderNumber })
      list.push({
        entityType: "filter_change_plans",
        entityId: p.id,
        moduleLabel: "filterChangeModule",
        recordLabel: p.memberAccount || p.orderNumber,
        scheduledDate: p.preD || p.planDate,
        dispatchStatus: p.dispatchStatus,
        customerId: p.customerId,
        orderNumber: p.orderNumber,
        email: customer?.email,
        requestedDate: p.requestedDate,
        requestedTime: p.requestedTime,
      })
    }
    for (const p of installPlans) {
      const customer = findCustomer(customers, saleListEntries, { orderNumber: p.orderNo })
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
        // used here only as the write-back target for a corrected email
        // (see doApprove), never persisted onto the plan row.
        customerId: customer?.id,
        orderNumber: p.orderNo,
        email: customer?.email,
        requestedDate: p.requestedDate,
        requestedTime: p.requestedTime,
      })
    }
    for (const c of collections) {
      const customer = findCustomer(customers, saleListEntries, { customerId: c.customerId, orderNumber: c.orderNo })
      list.push({
        entityType: "collections",
        entityId: c.id,
        moduleLabel: "collectionModule",
        recordLabel: c.accountName || c.orderNo,
        scheduledDate: c.preD || c.collectionDate,
        dispatchStatus: c.dispatchStatus,
        customerId: c.customerId,
        orderNumber: c.orderNo,
        email: customer?.email,
        requestedDate: c.requestedDate,
        requestedTime: c.requestedTime,
      })
    }
    for (const r of repairPlans) {
      // repair_plans has no email/customer_id column of its own — the
      // orderNumber match below (same fallback Installation already uses)
      // is the only way to resolve a real customer for it at all, both for
      // prefilling email here and as the write-back target below.
      const customer = findCustomer(customers, saleListEntries, { orderNumber: r.orderNo })
      list.push({
        entityType: "repair_plans",
        entityId: r.id,
        moduleLabel: "repairModule",
        recordLabel: r.accountName || r.orderNo,
        scheduledDate: r.preD || r.issuedDate,
        dispatchStatus: r.dispatchStatus,
        customerId: customer?.id,
        orderNumber: r.orderNo,
        email: customer?.email,
        requestedDate: r.requestedDate,
        requestedTime: r.requestedTime,
      })
    }
    return list
  }, [filterChangePlans, installPlans, collections, repairPlans, customers, saleListEntries])

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

  function emailFor(item: DispatchRow) {
    return emailDrafts[item.entityId] ?? item.email ?? ""
  }

  // Every other Confirmed/Pending Customer Confirmation/Draft row (any
  // module) that looks like the same customer as `item` — using the email
  // actually typed into this queue (not just item's own default), since
  // that's the most current signal for who this notification is really
  // going to.
  function findConflicts(item: DispatchRow, typedEmail: string): DispatchRow[] {
    const candidate = { customerId: item.customerId, orderNumber: item.orderNumber, email: typedEmail }
    return allRows.filter(
      (r) =>
        !(r.entityType === item.entityType && r.entityId === item.entityId) &&
        r.dispatchStatus &&
        CONFLICT_STATUSES.includes(r.dispatchStatus) &&
        isSameCustomer(r, candidate)
    )
  }

  // An email typed here otherwise only ever lands on this one dispatch
  // row's notify_email — the next dispatch for the same customer would
  // start blank again. Whenever this item resolved to a real customer
  // (customerId — see allRows above, filled in for every module now), and
  // the typed value differs from what's on that customer's permanent
  // record, save it back too. Deliberately one-directional and additive-
  // only: an empty typed value never clears/overwrites anything on the
  // customer record, it just means the email isn't sent this time.
  function saveContactToCustomer(item: DispatchRow, notifyEmail: string) {
    if (!item.customerId) return
    const customer = customers.find((c) => c.id === item.customerId)
    if (!customer) return
    if (notifyEmail && notifyEmail !== (customer.email ?? "")) {
      updateCustomer.mutate({ id: customer.id, input: { email: notifyEmail } })
    }
  }

  async function doApprove(item: DispatchRow, notifyEmail: string) {
    const result = await approve.mutateAsync({
      entityType: item.entityType,
      entityId: item.entityId,
      notifyEmail,
    })
    if (!result) return
    setLastResult(result)
    saveContactToCustomer(item, notifyEmail)
  }

  function handleApproveClick(item: DispatchRow) {
    const notifyEmail = emailFor(item).trim()
    if (!notifyEmail) return
    const conflicts = findConflicts(item, notifyEmail)
    if (conflicts.length > 0) {
      setPendingApproval({ item, notifyEmail, conflicts })
      return
    }
    doApprove(item, notifyEmail)
  }

  function handleSendAnyway() {
    if (!pendingApproval) return
    const { item, notifyEmail } = pendingApproval
    setPendingApproval(null)
    doApprove(item, notifyEmail)
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
      const notifyEmail = emailFor(item).trim()
      if (!notifyEmail) {
        skippedNoContact.push(item)
        continue
      }
      const candidate = { customerId: item.customerId, orderNumber: item.orderNumber, email: notifyEmail }
      // allRows (and therefore findConflicts) won't reflect an approval
      // that just happened earlier in *this* loop — the query cache only
      // updates once its invalidated queries actually refetch, which
      // doesn't happen synchronously inside this loop — so a same-batch
      // duplicate is checked separately against what's already been
      // approved so far this run.
      const conflicts = [...findConflicts(item, notifyEmail), ...approved.filter((a) => isSameCustomer(a, candidate))]
      if (conflicts.length > 0) {
        skippedConflict.push({ item, conflicts })
        continue
      }
      await doApprove(item, notifyEmail)
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

  function emailChannelBadge(result: DispatchChannelResult | undefined) {
    if (!result) return null
    const tone = result.status === "sent" ? "success" : result.status === "failed" ? "danger" : "neutral"
    const key = result.status === "sent" ? "emailSent" : result.status === "failed" ? "emailFailed" : "emailSkipped"
    return <StatusBadge tone={tone} label={t(key)} />
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3 pr-6">
              <span>{t("title")}</span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 font-normal"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="h-3.5 w-3.5" /> {t("historyButton")}
                </Button>
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
              </div>
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          {lastResult && (
            <div className="rounded-md border bg-muted/50 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {emailChannelBadge(lastResult.email)}
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
                      disabled={!emailFor(item).trim() || approve.isPending || bulkApproving}
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
                      {t("customerRequested")}{" "}
                      <span className="font-medium">{formatRequestedDate(item.requestedDate, locale)}</span>
                      {item.requestedTime && (
                        <span className="font-medium">
                          {t("at") ? ` ${t("at")} ` : " "}
                          {formatRequestedTime(item.requestedTime, locale)}
                        </span>
                      )}
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

      <DispatchHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  )
}
