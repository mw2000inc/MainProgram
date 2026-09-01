"use client"

import * as React from "react"
import { Send, TriangleAlert } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useApproveDispatchItem } from "@/lib/hooks/use-dispatch-confirmation"
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
}

// Best-effort customer lookup for prefilling a phone/email default — tries
// an explicit customerId link first (Filter Change, Collections), falling
// back to matching Customer.orderNumber (every module's own order number
// field lines up with it, since a Customer row is really "one row per
// order" in this app's data model) for the modules that don't carry a
// customerId at all (Installation).
function findCustomer(customers: Customer[], { customerId, orderNumber }: { customerId?: string; orderNumber?: string }) {
  if (customerId) {
    const byId = customers.find((c) => c.id === customerId)
    if (byId) return byId
  }
  if (orderNumber) return customers.find((c) => c.orderNumber === orderNumber)
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

const CONFLICT_STATUSES: DispatchStatus[] = ["Confirmed", "Pending Customer Confirmation", "Draft"]

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
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: customers = [] } = useCustomers()
  const approve = useApproveDispatchItem()

  const [phoneDrafts, setPhoneDrafts] = React.useState<Record<string, string>>({})
  const [emailDrafts, setEmailDrafts] = React.useState<Record<string, string>>({})
  const [lastResult, setLastResult] = React.useState<{ confirmUrl: string; sms?: DispatchChannelResult; email?: DispatchChannelResult } | null>(null)
  const [pendingApproval, setPendingApproval] = React.useState<{
    item: DispatchRow
    notifyPhone: string
    notifyEmail: string
    conflicts: DispatchRow[]
  } | null>(null)

  const allRows: DispatchRow[] = React.useMemo(() => {
    const list: DispatchRow[] = []
    for (const p of filterChangePlans) {
      const customer = findCustomer(customers, { customerId: p.customerId, orderNumber: p.orderNumber })
      list.push({
        entityType: "filter_change_plans",
        entityId: p.id,
        moduleLabel: "Filter Change",
        recordLabel: p.memberAccount || p.orderNumber,
        scheduledDate: p.preD || p.planDate,
        dispatchStatus: p.dispatchStatus,
        customerId: p.customerId,
        orderNumber: p.orderNumber,
        phone: p.contactNumber || undefined,
        email: customer?.email,
      })
    }
    for (const p of installPlans) {
      const customer = findCustomer(customers, { orderNumber: p.orderNo })
      list.push({
        entityType: "install_plans",
        entityId: p.id,
        moduleLabel: "Installation",
        recordLabel: p.name || p.orderNo,
        scheduledDate: p.preInstalledDate || p.inputDate,
        dispatchStatus: p.dispatchStatus,
        orderNumber: p.orderNo,
        phone: p.contactNumber || undefined,
        email: customer?.email,
      })
    }
    for (const c of collections) {
      const customer = findCustomer(customers, { customerId: c.customerId, orderNumber: c.orderNo })
      list.push({
        entityType: "collections",
        entityId: c.id,
        moduleLabel: "Collection",
        recordLabel: c.accountName || c.orderNo,
        scheduledDate: c.preD || c.collectionDate,
        dispatchStatus: c.dispatchStatus,
        customerId: c.customerId,
        orderNumber: c.orderNo,
        phone: customer?.contactNumber,
        email: customer?.email,
      })
    }
    for (const r of repairPlans) {
      list.push({
        entityType: "repair_plans",
        entityId: r.id,
        moduleLabel: "Repair",
        recordLabel: r.accountName || r.orderNo,
        scheduledDate: r.preD || r.issuedDate,
        dispatchStatus: r.dispatchStatus,
        orderNumber: r.orderNo,
        // No phone/email/customer link exists on repair_plans at all
        // today — order number is the only signal available to match it
        // against another module's row for the same customer.
      })
    }
    return list
  }, [filterChangePlans, installPlans, collections, repairPlans, customers])

  const items = React.useMemo(
    () => allRows.filter((r) => r.dispatchStatus === "Draft").sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)),
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

  async function doApprove(item: DispatchRow, notifyPhone: string, notifyEmail: string) {
    const result = await approve.mutateAsync({
      entityType: item.entityType,
      entityId: item.entityId,
      notifyPhone: notifyPhone || undefined,
      notifyEmail: notifyEmail || undefined,
    })
    if (result) setLastResult(result)
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

  function channelBadge(result: DispatchChannelResult | undefined, label: string) {
    if (!result) return null
    const tone = result.status === "sent" ? "success" : result.status === "failed" ? "danger" : "neutral"
    const text = result.status === "sent" ? `${label} sent` : result.status === "failed" ? `${label} failed` : `${label} skipped`
    return <StatusBadge tone={tone} label={text} />
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pending Dispatch Approval</DialogTitle>
            <DialogDescription>
              Newly-scheduled Filter Change, Installation, Collection, and Repair items wait here for admin approval.
              Approving sends a real SMS and/or email to whichever contact fields are filled in below.
            </DialogDescription>
          </DialogHeader>

          {lastResult && (
            <div className="rounded-md border bg-muted/50 p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {channelBadge(lastResult.sms, "SMS")}
                {channelBadge(lastResult.email, "Email")}
              </div>
              <p className="text-muted-foreground">
                Confirmation link: <span className="break-all font-mono">{lastResult.confirmUrl}</span>
              </p>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Nothing is waiting on approval right now.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div key={`${item.entityType}-${item.entityId}`} className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="secondary" label={item.moduleLabel} />
                        <span className="font-medium truncate">{item.recordLabel}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Scheduled {formatDate(item.scheduledDate)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-8 flex-1 min-w-[160px]"
                      placeholder="Phone number (SMS)"
                      value={phoneFor(item)}
                      onChange={(e) => setPhoneDrafts((prev) => ({ ...prev, [item.entityId]: e.target.value }))}
                    />
                    <Input
                      className="h-8 flex-1 min-w-[200px]"
                      placeholder="Email address"
                      value={emailFor(item)}
                      onChange={(e) => setEmailDrafts((prev) => ({ ...prev, [item.entityId]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={(!phoneFor(item).trim() && !emailFor(item).trim()) || approve.isPending}
                      onClick={() => handleApproveClick(item)}
                    >
                      <Send className="h-3.5 w-3.5" /> Approve
                    </Button>
                  </div>
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
              <TriangleAlert className="h-4 w-4 text-warning" /> Possible duplicate or conflict
            </DialogTitle>
            <DialogDescription>
              This customer already has {pendingApproval?.conflicts.length === 1 ? "another item" : "other items"} that look
              related — check before sending a notification for this one too.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {pendingApproval?.conflicts.map((c) => (
              <div key={`${c.entityType}-${c.entityId}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusBadge tone="secondary" label={c.moduleLabel} />
                  <span className="truncate">{c.recordLabel}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                  <span>{formatDate(c.scheduledDate)}</span>
                  <StatusBadge
                    tone={c.dispatchStatus === "Confirmed" ? "success" : c.dispatchStatus === "Draft" ? "neutral" : "warning"}
                    label={c.dispatchStatus ?? "Unknown"}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPendingApproval(null)}>
              Cancel
            </Button>
            <Button className="gap-1.5" disabled={approve.isPending} onClick={handleSendAnyway}>
              <Send className="h-3.5 w-3.5" /> Send Anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
