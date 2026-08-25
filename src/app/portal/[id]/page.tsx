"use client"

import { Suspense } from "react"
import { useParams } from "next/navigation"
import { CustomerScanView } from "@/components/portal/customer-scan-view"

// Legacy public route. The canonical route is now /scan/[customerId]; this is
// kept so any QR codes printed before the rename keep working. Both render the
// same read-only view. Suspense is required because CustomerScanView reads
// useSearchParams() (for the optional ?order= deep link from a per-order QR).
export default function CustomerPortalPage() {
  const params = useParams<{ id: string }>()
  return (
    <Suspense>
      <CustomerScanView customerId={params.id} />
    </Suspense>
  )
}
