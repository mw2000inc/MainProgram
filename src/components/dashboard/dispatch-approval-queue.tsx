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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusBadge } from "@/components/shared/status-badge"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useApproveDispatchItem } from "@/lib/hooks/use-dispatch-confirmation"
import { formatDate } from "@/lib/utils"
import type { DispatchEntityType } from "@/lib/api/dispatch-confirmation"

interface DraftItem {
  entityType: DispatchEntityType
  entityId: string
  moduleLabel: string
  recordLabel: string
  scheduledDate: string
  defaultContact: string
}

// Admin approval queue for newly-scheduled Filter Change/Installation/
// Collection/Repair dispatches (see the dispatch_confirmation_workflow
// migration) — only rows created via each module's own "Add" form start
// here at dispatchStatus='Draft'; auto-generated recurring-schedule/C/T-
// completion rows skip this queue entirely (see the migration's own
// comment for why). Approving here doesn't put the item on the Daily
// Report by itself — it moves it to "Pending Customer Confirmation" and
// logs what a real SMS/Email provider would be asked to send (none is
// connected yet); the item only reaches 'Confirmed' — and the Daily Report
// — once the customer visits their own /confirm/[token] link.
export function DispatchApprovalQueue({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: installPlans = [] } = useInstallPlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  const { data: customers = [] } = useCustomers()
  const approve = useApproveDispatchItem()

  const [contactDrafts, setContactDrafts] = React.useState<Record<string, string>>({})
  const [channelDrafts, setChannelDrafts] = React.useState<Record<string, "sms" | "email">>({})
  const [lastLink, setLastLink] = React.useState<string | null>(null)

  const items: DraftItem[] = React.useMemo(() => {
    const list: DraftItem[] = []
    for (const p of filterChangePlans) {
      if (p.dispatchStatus === "Draft") {
        list.push({
          entityType: "filter_change_plans",
          entityId: p.id,
          moduleLabel: "Filter Change",
          recordLabel: p.memberAccount || p.orderNumber,
          scheduledDate: p.preD || p.planDate,
          defaultContact: p.contactNumber || "",
        })
      }
    }
    for (const p of installPlans) {
      if (p.dispatchStatus === "Draft") {
        list.push({
          entityType: "install_plans",
          entityId: p.id,
          moduleLabel: "Installation",
          recordLabel: p.name || p.orderNo,
          scheduledDate: p.preInstalledDate || p.inputDate,
          defaultContact: p.contactNumber || "",
        })
      }
    }
    for (const c of collections) {
      if (c.dispatchStatus === "Draft") {
        const customer = customers.find((cust) => cust.id === c.customerId)
        list.push({
          entityType: "collections",
          entityId: c.id,
          moduleLabel: "Collection",
          recordLabel: c.accountName || c.orderNo,
          scheduledDate: c.preD || c.collectionDate,
          defaultContact: customer?.contactNumber || "",
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
          // No phone/customer link exists on repair_plans at all today —
          // the admin has to supply one here, there's nothing to default to.
          defaultContact: "",
        })
      }
    }
    return list.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
  }, [filterChangePlans, installPlans, collections, repairPlans, customers])

  function contactFor(item: DraftItem) {
    return contactDrafts[item.entityId] ?? item.defaultContact
  }
  function channelFor(item: DraftItem) {
    return channelDrafts[item.entityId] ?? (contactFor(item).includes("@") ? "email" : "sms")
  }

  async function handleApprove(item: DraftItem) {
    const notifyContact = contactFor(item).trim()
    if (!notifyContact) {
      return
    }
    const result = await approve.mutateAsync({
      entityType: item.entityType,
      entityId: item.entityId,
      notifyContact,
      channel: channelFor(item),
    })
    if (result) {
      setLastLink(`${window.location.origin}/confirm/${result.token}`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pending Dispatch Approval</DialogTitle>
          <DialogDescription>
            Newly-scheduled Filter Change, Installation, Collection, and Repair items wait here for admin approval
            before a confirmation request goes out to the customer.
          </DialogDescription>
        </DialogHeader>

        {lastLink && (
          <div className="rounded-md border bg-muted/50 p-3 text-xs">
            <p className="text-muted-foreground mb-1">
              No SMS/Email provider is connected yet — here&apos;s the confirmation link that would have been sent
              (also logged in dispatch_notifications):
            </p>
            <p className="break-all font-mono">{lastLink}</p>
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
                    className="h-8 flex-1 min-w-[180px]"
                    placeholder="Phone or email to notify"
                    value={contactFor(item)}
                    onChange={(e) => setContactDrafts((prev) => ({ ...prev, [item.entityId]: e.target.value }))}
                  />
                  <Select
                    value={channelFor(item)}
                    onValueChange={(v) => setChannelDrafts((prev) => ({ ...prev, [item.entityId]: v as "sms" | "email" }))}
                  >
                    <SelectTrigger className="h-8 w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sms">SMS</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={!contactFor(item).trim() || approve.isPending}
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
