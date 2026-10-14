"use client"

import * as React from "react"
import { TruncatedCell } from "@/components/shared/truncated-cell"
import { CustomerNameButton } from "@/components/shared/customer-details"
import { resolveCustomerForPlan } from "@/lib/customer-lookup"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { cn } from "@/lib/utils"

// A Filter Change / Collection / Installation / Repair record's Account Name
// with one fallback, the same everywhere: the record's own name, else its
// member — by the record's member link, else its Order No. through the Sale
// List (resolveCustomerForPlan) — showing the Member List Account Name, else
// the Contact Person. Display only: the record itself isn't changed (missing
// names on Collections were backfilled by 20261107000000). A technician
// can't read the Member List, so for them a blank name stays blank.
export function useAccountNameFallback() {
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  return React.useCallback(
    (orderNo: string | undefined, customerId: string | undefined): string | undefined => {
      const customer = resolveCustomerForPlan(customers, saleListEntries, customerId, orderNo ?? "")
      return customer ? customer.companyName?.trim() || customer.fullName?.trim() || undefined : undefined
    },
    [customers, saleListEntries]
  )
}

export function RecordAccountNameCell({
  name,
  orderNo,
  customerId,
  className,
}: {
  name?: string | null
  orderNo?: string
  customerId?: string
  className?: string
}) {
  const fallback = useAccountNameFallback()
  const shown = name?.trim() || fallback(orderNo, customerId)
  if (!shown) return <TruncatedCell value={undefined} className={className} />
  // Clicking the name opens the Customer Details pop-up (the row's own click
  // — opening its record — isn't triggered). A looked-up name is shown a
  // shade lighter, so it reads as looked up rather than typed.
  return (
    <span className={cn("block max-w-37.5", className)}>
      <CustomerNameButton target={{ customerId, orderNo, name: shown }} className={name?.trim() ? undefined : "text-muted-foreground"}>
        {shown}
      </CustomerNameButton>
    </span>
  )
}
