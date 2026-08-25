"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import {
  Mail,
  MapPin,
  Phone,
  Wrench,
  Droplet,
  Droplets,
  Banknote,
  Building2,
  ShieldCheck,
  CalendarDays,
  Hash,
  ClipboardCheck,
  IdCard,
  Receipt,
  ArrowLeft,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/data-table/data-table"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { MonitoringViewStatusBadge } from "@/components/shared/status-badge"
import { Logo } from "@/components/shared/logo"
import { usePortalProfile } from "@/lib/hooks/use-portal"
import { getFilterChangeColumns } from "@/components/filter-change/filter-change-columns"
import { getCollectionsColumns } from "@/components/collections/collections-columns"
import { getRepairColumns } from "@/components/repair/repair-columns"
import { getSaleListSummaryColumns, type SaleListRow } from "@/components/sale-list/sale-list-columns"
import { ensurePrimaryOrderRow } from "@/lib/sale-list"
import {
  formatDate,
  getMonitoringEndDate,
  getMonitoringIntervalMonths,
  getMonitoringStatus,
  initials,
} from "@/lib/utils"
import { getServiceHistory } from "@/lib/service-history"

// Shared, read-only customer profile shown after scanning a QR code. Rendered by
// both /scan/[customerId] (the canonical public route) and /portal/[id] (kept
// working for any QR codes printed before the rename). No auth, no edit controls.
export function CustomerScanView({ customerId }: { customerId: string }) {
  const { data: profile, isPending } = usePortalProfile(customerId)
  const customer = profile?.customer
  const settings = profile?.settings
  const filterChanges = profile?.filterChanges ?? []
  const collections = profile?.collections ?? []
  const repairs = profile?.repairs ?? []
  const [selectedOrder, setSelectedOrder] = React.useState<SaleListRow | null>(null)
  const [activeTab, setActiveTab] = React.useState("personal")

  // The customer's own order_number always shows up as its own row here too
  // — synthesized if no sale_list_entries row already shares that exact
  // number — so it's never possible to "lose" that order just because it was
  // never entered as a formal sale-list line item.
  const saleListRows: SaleListRow[] = React.useMemo(() => {
    if (!customer) return []
    const accountLabel = customer.companyName || customer.fullName
    const rows = (profile?.saleList ?? []).map((sl) => ({ ...sl, accountLabel }))
    return ensurePrimaryOrderRow(rows, customer)
  }, [profile, customer])

  // Deep link from a per-order QR (?order=001-0009, see member-related-sales.tsx)
  // — once the profile loads, jump straight to that order instead of the
  // default tab, if it's actually one of this customer's own orders
  // (including the synthesized primary-order row above).
  const searchParams = useSearchParams()
  const orderParam = searchParams.get("order")
  React.useEffect(() => {
    if (!orderParam || saleListRows.length === 0) return
    const match = saleListRows.find((sl) => sl.orderNumber === orderParam)
    if (match) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedOrder(match)
      setActiveTab("orders")
    }
  }, [orderParam, saleListRows])

  const filterChangeColumns = React.useMemo(() => getFilterChangeColumns(), [])
  const collectionsColumns = React.useMemo(() => getCollectionsColumns(), [])
  const repairColumns = React.useMemo(() => getRepairColumns(), [])
  const saleListColumns = React.useMemo(() => getSaleListSummaryColumns(), [])

  const content = (() => {
    if (isPending) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      )
    }

    if (!customer) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <p className="text-lg font-medium">We couldn&apos;t find this profile</p>
          <p className="text-sm text-muted-foreground">The QR code may be invalid or the record no longer exists.</p>
        </div>
      )
    }

    // End Date = installed date (falling back to contract start when not yet on
    // file) + the interval configured for this product type in Settings.
    const anchor = customer.installedDate ?? customer.contractStart
    const intervalMonths = getMonitoringIntervalMonths(customer.dispenserType, settings)
    const endDate = getMonitoringEndDate(anchor, intervalMonths)
    const status = getMonitoringStatus(endDate)
    const serviceHistory = getServiceHistory(customer)

    return (
      <>
        <Card>
          <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 pt-6">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="bg-primary text-primary-foreground text-lg">
                {initials(customer.fullName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{customer.fullName}</h1>
                <MonitoringViewStatusBadge status={status} />
              </div>
              {customer.companyName && <p className="text-sm text-muted-foreground">{customer.companyName}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                Member Account#: <span className="font-mono">{customer.memberAccountNumber}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted/40 border-dashed">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              This is a read-only view of your account. Only MW2000 staff can make changes — contact us below if
              anything needs updating.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IdCard className="h-4 w-4" /> Member Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <InfoRow label="Member Account#" value={customer.memberAccountNumber || "N/A"} />
            <InfoRow label="Account Name" value={customer.companyName || "N/A"} />
            <InfoRow label="Account Contact Person" value={customer.fullName || "N/A"} />
            <InfoRow label="Contact Number 1 (Main)" value={customer.contactNumber || "N/A"} />
            <InfoRow label="Contact Number 2 (Sub)" value={customer.contactNumber2 || "N/A"} />
            <InfoRow label="Address" value={customer.address || "N/A"} className="sm:col-span-2" />
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="personal">Member Information</TabsTrigger>
            <TabsTrigger value="service">Service History</TabsTrigger>
            <TabsTrigger value="orders">Orders</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal Information</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <InfoRow icon={Hash} label="Order Number" value={customer.orderNumber} />
                <InfoRow
                  icon={CalendarDays}
                  label="Installed Date"
                  value={customer.installedDate ? formatDate(customer.installedDate) : "N/A"}
                />
                <InfoRow icon={Mail} label="Email Address" value={customer.email} />
                <InfoRow icon={Phone} label="Contact Number" value={customer.contactNumber} />
                <InfoRow icon={MapPin} label="Address" value={customer.address} className="sm:col-span-2" />
                <InfoRow icon={Droplet} label="Water Purification Type" value={customer.dispenserType} />
                <InfoRow
                  icon={Droplet}
                  label="Water Filter Installed"
                  value={customer.filterInstalled ? "Yes" : "No"}
                />
                <InfoRow icon={Wrench} label="Assigned Technician" value={customer.assignedTechnician || "N/A"} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="service">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Service History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {serviceHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground">No service visits recorded yet.</p>
                )}
                {serviceHistory.map((visit, i) => (
                  <div key={i} className="flex gap-3 border-b pb-4 last:border-0 last:pb-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Wrench className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{visit.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(visit.date)} &middot; {visit.technician}
                      </p>
                      <p className="text-sm mt-1">{visit.notes}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders" className="space-y-6">
            {!selectedOrder ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Receipt className="h-4 w-4" /> Related Sales
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={saleListColumns}
                    data={saleListRows}
                    searchPlaceholder="Search orders..."
                    emptyMessage="No related sales for this account."
                    onRowClick={(row) => setSelectedOrder(row)}
                  />
                </CardContent>
              </Card>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Orders
                </button>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4" /> Order {selectedOrder.orderNumber}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <InfoRow label="Order Number" value={selectedOrder.orderNumber} />
                    <InfoRow
                      label="Installed Date"
                      value={selectedOrder.installedDate ? formatDate(selectedOrder.installedDate) : "N/A"}
                    />
                    <InfoRow label="Account#" value={selectedOrder.accountLabel} />
                    <InfoRow label="Product#" value={selectedOrder.productNo || "N/A"} />
                    <InfoRow label="S/C" value={selectedOrder.sc || "N/A"} />
                    <InfoRow label="C/F" value={selectedOrder.cf || "N/A"} />
                    <InfoRow label="C/T" value={selectedOrder.ct || "N/A"} />
                    <InfoRow label="CP y1/y2" value={selectedOrder.cpY1Y2 || "N/A"} />
                    <InfoRow
                      label="CP start"
                      value={selectedOrder.cpStart ? formatDate(selectedOrder.cpStart) : "N/A"}
                    />
                    <InfoRow label="CP end" value={selectedOrder.cpEnd ? formatDate(selectedOrder.cpEnd) : "N/A"} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Droplets className="h-4 w-4" /> Filter Changes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={filterChangeColumns}
                      data={filterChanges.filter((f) => f.orderNumber === selectedOrder.orderNumber)}
                      searchPlaceholder="Search filter changes..."
                      emptyMessage="No filter change history for this order."
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Banknote className="h-4 w-4" /> Collections
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={collectionsColumns}
                      data={collections.filter((c) => c.orderNo === selectedOrder.orderNumber)}
                      searchPlaceholder="Search collections..."
                      emptyMessage="No collection history for this order."
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="h-4 w-4" /> Repairs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={repairColumns}
                      data={repairs.filter((r) => r.orderNo === selectedOrder.orderNumber)}
                      searchPlaceholder="Search repairs..."
                      emptyMessage="No repair history for this order."
                    />
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Need help? Contact us
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow icon={MapPin} label="Location" value={settings?.address || "N/A"} />
            {(settings?.contactNumbers ?? []).map((entry, i) => (
              <InfoRow key={`num-${i}`} icon={Phone} label={entry.label} value={entry.value} />
            ))}
            {(settings?.contactEmails ?? []).map((entry, i) => (
              <InfoRow key={`email-${i}`} icon={Mail} label={entry.label} value={entry.value} />
            ))}
          </CardContent>
        </Card>
      </>
    )
  })()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-2xl mx-auto flex items-center gap-2 px-4 py-4">
          <Logo className="h-9 w-9 shrink-0" />
          <div className="leading-tight">
            <p className="font-semibold text-sm">{settings?.companyName ?? "MW2000"}</p>
            <p className="text-xs text-muted-foreground">Customer Profile</p>
          </div>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">{content}</main>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon?: React.ElementType
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="h-3.5 w-3.5" />} {label}
      </p>
      <div className="font-medium">{value}</div>
    </div>
  )
}
