"use client"

import * as React from "react"
import { Send } from "lucide-react"
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
import type { Customer } from "@/lib/types"

interface DraftItem {
  entityType: DispatchEntityType
  entityId: string
  moduleLabel: string
  recordLabel: string
  scheduledDate: string
  defaultPhone: string
  defaultEmail: string
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

// Admin approval queue for newly-scheduled Filter Change/Installation/
// Collection/Repair dispatches (see the dispatch_confirmation_workflow and
// dispatch_dual_channel_notifications migrations) — only rows created via
// each module's own "Add" form start here at dispatchStatus='Draft';
// auto-generated recurring-schedule/C/T-completion rows skip this queue
// entirely (see the migration's own comment for why). Approving here
// always attempts BOTH a real SMS (Semaphore) and a real email (Resend)
// to whichever of phone/email is filled in — either can be left blank to
// skip that channel entirely, but at least one is required.
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

  const items: DraftItem[] = React.useMemo(() => {
    const list: DraftItem[] = []
    for (const p of filterChangePlans) {
      if (p.dispatchStatus === "Draft") {
        const customer = findCustomer(customers, { customerId: p.customerId, orderNumber: p.orderNumber })
        list.push({
          entityType: "filter_change_plans",
          entityId: p.id,
          moduleLabel: "Filter Change",
          recordLabel: p.memberAccount || p.orderNumber,
          scheduledDate: p.preD || p.planDate,
          defaultPhone: p.contactNumber || "",
          defaultEmail: customer?.email || "",
        })
      }
    }
    for (const p of installPlans) {
      if (p.dispatchStatus === "Draft") {
        const customer = findCustomer(customers, { orderNumber: p.orderNo })
        list.push({
          entityType: "install_plans",
          entityId: p.id,
          moduleLabel: "Installation",
          recordLabel: p.name || p.orderNo,
          scheduledDate: p.preInstalledDate || p.inputDate,
          defaultPhone: p.contactNumber || "",
          defaultEmail: customer?.email || "",
        })
      }
    }
    for (const c of collections) {
      if (c.dispatchStatus === "Draft") {
        const customer = findCustomer(customers, { customerId: c.customerId, orderNumber: c.orderNo })
        list.push({
          entityType: "collections",
          entityId: c.id,
          moduleLabel: "Collection",
          recordLabel: c.accountName || c.orderNo,
          scheduledDate: c.preD || c.collectionDate,
          defaultPhone: customer?.contactNumber || "",
          defaultEmail: customer?.email || "",
        })
      }
    }
    for (const r of repairPlans) {
      if (r.dispatchStatus === "Draft") {
        list.push({
          entityType: "repair_plans",
          entityId: r.id,
          moduleLabel: "Repair",
          recordLabel: r.accountName || r.orderNo,
          scheduledDate: r.preD || r.issuedDate,
          // No phone/email/customer link exists on repair_plans at all
          // today — the admin has to supply these here, there's nothing
          // to default to.
          defaultPhone: "",
          defaultEmail: "",
        })
      }
    }
    return list.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
  }, [filterChangePlans, installPlans, collections, repairPlans, customers])

  function phoneFor(item: DraftItem) {
    return phoneDrafts[item.entityId] ?? item.defaultPhone
  }
  function emailFor(item: DraftItem) {
    return emailDrafts[item.entityId] ?? item.defaultEmail
  }

  async function handleApprove(item: DraftItem) {
    const notifyPhone = phoneFor(item).trim()
    const notifyEmail = emailFor(item).trim()
    if (!notifyPhone && !notifyEmail) return
    const result = await approve.mutateAsync({
      entityType: item.entityType,
      entityId: item.entityId,
      notifyPhone: notifyPhone || undefined,
      notifyEmail: notifyEmail || undefined,
    })
    if (result) setLastResult(result)
  }

  function channelBadge(result: DispatchChannelResult | undefined, label: string) {
    if (!result) return null
    const tone = result.status === "sent" ? "success" : result.status === "failed" ? "danger" : "neutral"
    const text = result.status === "sent" ? `${label} sent` : result.status === "failed" ? `${label} failed` : `${label} skipped`
    return <StatusBadge tone={tone} label={text} />
  }

  return (
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
                    onClick={() => handleApprove(item)}
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
  )
}
