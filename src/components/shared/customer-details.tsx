"use client"

import * as React from "react"
import Link from "next/link"
import { ExternalLink, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DirectionsLink, PhoneActions } from "@/components/shared/contact-actions"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"

// Who a customer-name click is about: the member (by id, else by Order No.
// through the Sale List) and what the clicked row itself knows — shown when
// there's no member to read (a technician can't read the Member List, or the
// order isn't on the Sale List).
export type CustomerDetailsTarget = { customerId?: string; orderNo?: string; name?: string; address?: string; contactNumber?: string }

// One pop-up for the whole app (CustomerDetailsHost, mounted in the app
// layout): any table cell can open it without leaving the page, so the panel
// behind keeps its place.
let current: CustomerDetailsTarget | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export function openCustomerDetails(target: CustomerDetailsTarget) {
  current = target
  emit()
}
function closeCustomerDetails() {
  current = null
  emit()
}
function useCustomerDetailsTarget() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
    () => null
  )
}

// A customer name that opens the pop-up. The click stops here, so the row
// behind it (which would open its record) isn't triggered.
export function CustomerNameButton({ target, className, children }: { target: CustomerDetailsTarget; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn("max-w-full truncate text-left hover:underline focus-visible:underline focus-visible:outline-none", className)}
      title={typeof children === "string" ? children : undefined}
      // Only the pop-up: the row's own click (open its record), any link or
      // drag/press handler around it, and the default action all stop here.
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openCustomerDetails(target)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      data-testid="customer-name-button"
    >
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 wrap-break-word">{value || "—"}</span>
    </div>
  )
}

export function CustomerDetailsHost() {
  const target = useCustomerDetailsTarget()
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && closeCustomerDetails()}>
      {/* The body (and its Member List / Sale List reads) only mounts while open. */}
      {target && <CustomerDetailsBody target={target} />}
    </Dialog>
  )
}

function CustomerDetailsBody({ target }: { target: CustomerDetailsTarget }) {
  const { t } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: cpSystems = [] } = useCpSystems()

  const info = React.useMemo(() => {
    const order = (target.orderNo ?? "").trim()
    const customer = resolveCustomerForPlan(customers, saleListEntries, target.customerId, order)
    const sale = order ? saleListEntries.find((e) => e.orderNumber.trim() === order) : undefined
    const system = sale?.cpSystemId ? cpSystems.find((s) => s.id === sale.cpSystemId) : undefined
    const orders = customer ? saleListEntries.filter((e) => e.customerId === customer.id).map((e) => e.orderNumber.trim()) : []
    return { order, customer, sale, system, orders }
  }, [target, customers, saleListEntries, cpSystems])

  const c = info?.customer
  const accountName = c?.companyName?.trim() || target?.name || c?.fullName
  const contactPerson = c?.fullName?.trim() && c.fullName.trim() !== accountName ? c.fullName : undefined
  const address = c?.address || target?.address
  const contact = [c?.contactNumber || target?.contactNumber, c?.contactNumber2].filter(Boolean).join(" · ")

  return (
      <DialogContent className="sm:max-w-lg" data-testid="customer-details-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-primary" /> {accountName || t("customerDetails")}
          </DialogTitle>
          <DialogDescription>{info?.order ? `${t("customerDetails")} · ${info.order}` : t("customerDetails")}</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <div className="pb-2">
            <Row label={tFields("accountName")} value={accountName} />
            <Row label={t("contactPerson")} value={contactPerson} />
            <Row label={tFields("memberAccount")} value={c?.memberAccountNumber?.trim()} />
          </div>
          <div className="py-2">
            <Row
              label={tFields("address")}
              value={
                address ? (
                  <DirectionsLink address={address} latitude={c?.latitude} longitude={c?.longitude} iconClassName="h-3.5 w-3.5" />
                ) : undefined
              }
            />
            <Row
              label={tFields("contactNumber")}
              value={
                contact ? (
                  <PhoneActions value={contact} iconClassName="h-3.5 w-3.5" />
                ) : undefined
              }
            />
          </div>
          <div className="py-2">
            <Row label={t("productModel")} value={info?.sale?.productNo?.trim() || c?.dispenserType?.trim()} />
            <Row label="S/C · CP" value={[info?.sale?.sc?.trim(), info?.system?.systemCode].filter(Boolean).join(" · ")} />
            <Row label={tFields("installedDate")} value={info?.sale?.installedDate ? formatDate(info.sale.installedDate) : c?.installedDate ? formatDate(c.installedDate) : undefined} />
            {info && info.orders.length > 1 && <Row label={t("otherOrders")} value={info.orders.filter((o) => o !== info.order).join(", ")} />}
          </div>
          <div className="pt-2">
            <Row label={t("notes")} value={[c?.notes?.trim(), info?.sale?.note?.trim()].filter(Boolean).join(" — ")} />
          </div>
        </div>
        {!c && <p className="text-xs text-muted-foreground">{t("customerNotOnMemberList")}</p>}
        {c && (
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/customers/${c.id}`} onClick={() => closeCustomerDetails()}>
                <ExternalLink className="h-3.5 w-3.5" /> {t("openMemberPage")}
              </Link>
            </Button>
          </div>
        )}
      </DialogContent>
  )
}
