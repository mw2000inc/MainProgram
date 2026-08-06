"use client"

import { useParams } from "next/navigation"
import { CustomerScanView } from "@/components/portal/customer-scan-view"

// Legacy public route. The canonical route is now /scan/[customerId]; this is
// kept so any QR codes printed before the rename keep working. Both render the
// same read-only view.
export default function CustomerPortalPage() {
  const params = useParams<{ id: string }>()
  return <CustomerScanView customerId={params.id} />
}
