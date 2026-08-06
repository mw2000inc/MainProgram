"use client"

import { useParams } from "next/navigation"
import { CustomerScanView } from "@/components/portal/customer-scan-view"

// Public, no-login route linked from a customer's printed QR card. The QR only
// ever encodes a single customer id; all data access goes through the
// security-definer get_portal_profile RPC, so no other customer is reachable.
export default function CustomerScanPage() {
  const params = useParams<{ customerId: string }>()
  return <CustomerScanView customerId={params.customerId} />
}
