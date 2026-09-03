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
import { useTranslation, usePreAuthLocale } from "@/lib/i18n/i18n-context"
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
  const { t } = useTranslation("portal")
  const { t: tFields } = useTranslation("fields")
  const { t: tMember } = useTranslation("member")
  const { locale, setLocale } = usePreAuthLocale()
  const { data: profile, isPending } = usePortalProfile(customerId)
  const customer = profile?.customer
  const settings = profile?.settings
  const filterChanges = profile?.filterChanges ?? []
  const collections = profile?.collections ?? []
  const repairs = profile?.repairs ?? []
  const [selectedOrder, setSelectedOrder] = React.useState<SaleListRow | null>(null)
  const [activeTab, setActiveTab] = React.useState("personal")

  const saleListRows: SaleListRow[] = React.useMemo(() => {
    if (!customer) return []
    const accountLabel = customer.companyName || customer.fullName
    return (profile?.saleList ?? []).map((sl) => ({ ...sl, accountLabel }))
  }, [profile, customer])

  // Deep link from a per-order QR (?order=001-0009, see member-related-sales.tsx)
  // — once the profile loads, jump straight to that order instead of the
  // default tab, if it's actually one of this customer's own orders.
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
          <p className="text-lg font-medium">{t("profileNotFoundTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("profileNotFoundDescription")}</p>
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
                <h1 className="text-xl font-semibold">{customer.companyName || customer.fullName}</h1>
                <MonitoringViewStatusBadge status={status} />
              </div>
              {customer.companyName && <p className="text-sm text-muted-foreground">{customer.fullName}</p>}
              <p className="text-xs text-muted-foreground mt-1">
                {tFields("memberAccount")}: <span className="font-mono">{customer.memberAccountNumber}</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted/40 border-dashed">
          <CardContent className="flex items-start gap-3 py-4">
            <ShieldCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">{t("readOnlyNotice")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IdCard className="h-4 w-4" /> {t("memberInformation")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <InfoRow label={tFields("memberAccount")} value={customer.memberAccountNumber || t("na")} />
            <InfoRow label={tFields("accountName")} value={customer.companyName || t("na")} />
            <InfoRow label={t("accountContactPerson")} value={customer.fullName || t("na")} />
            <InfoRow label={tMember("contactNumber1MainHeader")} value={customer.contactNumber || t("na")} />
            <InfoRow label={tMember("contactNumber2SubHeader")} value={customer.contactNumber2 || t("na")} />
            <InfoRow label={tFields("address")} value={customer.address || t("na")} className="sm:col-span-2" />
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto group-data-horizontal/tabs:h-auto">
            <TabsTrigger value="personal">{t("memberInformation")}</TabsTrigger>
            <TabsTrigger value="service">{t("serviceHistory")}</TabsTrigger>
            <TabsTrigger value="orders">{t("orders")}</TabsTrigger>
          </TabsList>

          <TabsContent value="personal">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("personalInformation")}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <InfoRow icon={Hash} label={tFields("orderNumber")} value={customer.orderNumber} />
                <InfoRow
                  icon={CalendarDays}
                  label={tFields("installedDate")}
                  value={customer.installedDate ? formatDate(customer.installedDate) : t("na")}
                />
                <InfoRow icon={Mail} label={tMember("emailAddress")} value={customer.email} />
                <InfoRow icon={Phone} label={t("contactNumber")} value={customer.contactNumber} />
                <InfoRow icon={MapPin} label={tFields("address")} value={customer.address} className="sm:col-span-2" />
                <InfoRow icon={Droplet} label={t("waterPurificationType")} value={customer.dispenserType} />
                <InfoRow
                  icon={Droplet}
                  label={t("waterFilterInstalled")}
                  value={customer.filterInstalled ? t("yes") : t("no")}
                />
                <InfoRow icon={Wrench} label={t("assignedTechnician")} value={customer.assignedTechnician || t("na")} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="service">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("serviceHistory")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {serviceHistory.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("noServiceVisits")}</p>
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
                    <Receipt className="h-4 w-4" /> {t("relatedSales")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={saleListColumns}
                    data={saleListRows}
                    searchPlaceholder={t("searchOrders")}
                    emptyMessage={t("noRelatedSales")}
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
                  <ArrowLeft className="h-3.5 w-3.5" /> {t("backToOrders")}
                </button>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4" /> {t("orderNumberTitle", { number: selectedOrder.orderNumber })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <InfoRow label={tFields("orderNumber")} value={selectedOrder.orderNumber} />
                    <InfoRow
                      label={tFields("installedDate")}
                      value={selectedOrder.installedDate ? formatDate(selectedOrder.installedDate) : t("na")}
                    />
                    <InfoRow label={tFields("account")} value={selectedOrder.accountLabel} />
                    <InfoRow label={tFields("productNo")} value={selectedOrder.productNo || t("na")} />
                    <InfoRow label={tFields("sc")} value={selectedOrder.sc || t("na")} />
                    <InfoRow label={tFields("cf")} value={selectedOrder.cf || t("na")} />
                    <InfoRow label={tFields("ct")} value={selectedOrder.ct || t("na")} />
                    <InfoRow label={tFields("cpY1Y2")} value={selectedOrder.cpY1Y2 || t("na")} />
                    <InfoRow
                      label={tFields("cpStart")}
                      value={selectedOrder.cpStart ? formatDate(selectedOrder.cpStart) : t("na")}
                    />
                    <InfoRow label={tFields("cpEnd")} value={selectedOrder.cpEnd ? formatDate(selectedOrder.cpEnd) : t("na")} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Droplets className="h-4 w-4" /> {t("filterChanges")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={filterChangeColumns}
                      data={filterChanges.filter((f) => f.orderNumber === selectedOrder.orderNumber)}
                      searchPlaceholder={t("searchFilterChanges")}
                      emptyMessage={t("noFilterChangeHistory")}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Banknote className="h-4 w-4" /> {t("collections")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={collectionsColumns}
                      data={collections.filter((c) => c.orderNo === selectedOrder.orderNumber)}
                      searchPlaceholder={t("searchCollections")}
                      emptyMessage={t("noCollectionHistory")}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Wrench className="h-4 w-4" /> {t("repairs")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      columns={repairColumns}
                      data={repairs.filter((r) => r.orderNo === selectedOrder.orderNumber)}
                      searchPlaceholder={t("searchRepairs")}
                      emptyMessage={t("noRepairHistory")}
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
              <Building2 className="h-4 w-4" /> {t("needHelpContactUs")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow icon={MapPin} label={t("location")} value={settings?.address || t("na")} />
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
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex items-center gap-2">
            <Logo className="h-9 w-9 shrink-0" />
            <div className="leading-tight">
              <p className="font-semibold text-sm">{settings?.companyName ?? "MW2000"}</p>
              <p className="text-xs text-muted-foreground">{t("customerProfile")}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              className={locale === "en" ? "font-semibold underline" : "text-muted-foreground"}
              onClick={() => setLocale("en")}
            >
              English
            </button>
            <span className="text-muted-foreground">/</span>
            <button
              type="button"
              className={locale === "ko" ? "font-semibold underline" : "text-muted-foreground"}
              onClick={() => setLocale("ko")}
            >
              한국어
            </button>
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
