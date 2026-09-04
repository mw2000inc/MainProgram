"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Hash,
  Package,
  Droplets,
  Banknote,
  Wrench,
  CalendarDays,
  Users,
  ArrowRight,
  Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusCell } from "@/components/sale-list/sale-list-columns"
import { OrderRelatedSection } from "@/components/sale-list/order-related-section"
import { FilterChangeFormDialog } from "@/components/filter-change/filter-change-form-dialog"
import { getFilterChangeColumns, getFilterChangeExpandedColumns, FILTER_CHANGE_EXPORT_COLUMNS } from "@/components/filter-change/filter-change-columns"
import { CollectionsFormDialog } from "@/components/collections/collections-form-dialog"
import { getCollectionsColumns, COLLECTIONS_EXPORT_COLUMNS } from "@/components/collections/collections-columns"
import { RepairFormDialog } from "@/components/repair/repair-form-dialog"
import { getRepairColumns, REPAIR_EXPORT_COLUMNS } from "@/components/repair/repair-columns"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import { useReportDetailPanelOpen } from "@/lib/sidebar-collapse-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, initials, todayIso as today } from "@/lib/utils"

export default function SaleListOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { t } = useTranslation("saleList")
  const { t: tNav } = useTranslation("nav")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tMember } = useTranslation("member")

  // Same as the main Sale List page — collapses the nav rail for as long as
  // this page is mounted, re-expanding on navigating away. This page is
  // reached directly (a Member's "Related Sales" link, a QR scan) without
  // ever passing through the list page's own registration, so it needs its
  // own call rather than relying on that one.
  useReportDetailPanelOpen(true)

  const { data: entries = [], isPending: pEntries } = useSaleListEntries()
  const { data: customers = [], isPending: pCustomers } = useCustomers()
  const { data: filterChangePlans = [], isPending: pFilter } = useFilterChangePlans()
  const { data: collections = [], isPending: pCollections } = useCollections()
  const { data: repairPlans = [], isPending: pRepairs } = useRepairPlans()
  const { data: cpSystems = [] } = useCpSystems()

  const [filterFormOpen, setFilterFormOpen] = React.useState(false)
  const [collectionFormOpen, setCollectionFormOpen] = React.useState(false)
  const [repairFormOpen, setRepairFormOpen] = React.useState(false)

  const entry = entries.find((e) => e.id === params.id)
  const customer = entry
    ? customers.find((c) => c.id === entry.customerId) ?? customers.find((c) => c.orderNumber === entry.orderNumber)
    : undefined

  const filterChangeColumns = React.useMemo(() => getFilterChangeColumns(), [])
  const filterChangeExpandedColumns = React.useMemo(() => getFilterChangeExpandedColumns(), [])
  const collectionsColumns = React.useMemo(() => getCollectionsColumns(), [])
  const repairColumns = React.useMemo(() => getRepairColumns(), [])

  const orderFilterChanges = React.useMemo(
    () => (entry ? filterChangePlans.filter((p) => p.orderNumber === entry.orderNumber) : []),
    [filterChangePlans, entry]
  )
  const orderCollections = React.useMemo(
    () => (entry ? collections.filter((c) => c.orderNo === entry.orderNumber) : []),
    [collections, entry]
  )
  const orderRepairs = React.useMemo(
    () => (entry ? repairPlans.filter((r) => r.orderNo === entry.orderNumber) : []),
    [repairPlans, entry]
  )
  const linkedCpSystem = React.useMemo(
    () => (entry?.cpSystemId ? cpSystems.find((s) => s.id === entry.cpSystemId) : undefined),
    [cpSystems, entry]
  )

  const isPending = pEntries || pCustomers || pFilter || pCollections || pRepairs

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <p className="text-lg font-medium">{t("orderNotFound")}</p>
        <Button variant="outline" onClick={() => router.push("/sale-list")}>
          {t("backToSaleList")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push("/sale-list")}>
        <ArrowLeft className="h-4 w-4" /> {t("backToSaleList")}
      </Button>

      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-4 pt-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Hash className="h-7 w-7" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold font-mono">{entry.orderNumber}</h1>
              <StatusCell status={entry.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {customer?.companyName || customer?.fullName || t("noMemberLinked")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("orderInfo")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <InfoRow icon={Hash} label={tFields("orderNumber")} value={entry.orderNumber} />
            <InfoRow
              icon={CalendarDays}
              label={tFields("installedDate")}
              value={entry.installedDate ? formatDate(entry.installedDate) : tCommon("notAvailable")}
            />
            <InfoRow icon={Users} label={tFields("memberAccount")} value={customer?.memberAccountNumber || tCommon("notAvailable")} />
            <InfoRow icon={Package} label={tFields("productNo")} value={entry.productNo || tCommon("notAvailable")} />
            <InfoRow icon={Hash} label={tFields("sc")} value={entry.sc || tCommon("notAvailable")} />
            <InfoRow
              icon={Layers}
              label={t("cpSystem")}
              value={
                linkedCpSystem ? (
                  <Link href={`/cp-system?id=${linkedCpSystem.id}`} className="text-primary hover:underline">
                    {linkedCpSystem.systemCode}
                  </Link>
                ) : (
                  tCommon("notAvailable")
                )
              }
            />
            <InfoRow icon={Hash} label={tFields("cf")} value={entry.cf || tCommon("notAvailable")} />
            <InfoRow icon={Hash} label={tFields("ct")} value={entry.ct || tCommon("notAvailable")} />
            <InfoRow icon={Hash} label={tFields("cpY1Y2")} value={entry.cpY1Y2 || tCommon("notAvailable")} />
            <InfoRow icon={CalendarDays} label={tFields("cpStart")} value={entry.cpStart ? formatDate(entry.cpStart) : tCommon("notAvailable")} />
            <InfoRow icon={CalendarDays} label={tFields("cpEnd")} value={entry.cpEnd ? formatDate(entry.cpEnd) : tCommon("notAvailable")} />
            {entry.note && <InfoRow icon={Hash} label={tFields("note")} value={entry.note} className="sm:col-span-2" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tNav("member")}</CardTitle>
          </CardHeader>
          <CardContent>
            {customer ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-11 w-11">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {initials(customer.fullName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{customer.companyName || customer.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{customer.memberAccountNumber || "—"}</p>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <InfoRow icon={Hash} label={tFields("contactNumber")} value={customer.contactNumber || tCommon("notAvailable")} />
                  <InfoRow icon={Hash} label={tFields("email")} value={customer.email || tCommon("notAvailable")} />
                  <InfoRow icon={Hash} label={tFields("address")} value={customer.address || tCommon("notAvailable")} />
                </div>
                <Link href={`/customers/${customer.id}`}>
                  <Button variant="outline" size="sm" className="w-full gap-1.5">
                    {t("viewFullMemberProfile")} <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("noMemberLinkedDescription")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <OrderRelatedSection
        title={tMember("filterChangesSection")}
        icon={Droplets}
        data={orderFilterChanges}
        dateKey="planDate"
        columns={filterChangeColumns}
        expandedColumns={filterChangeExpandedColumns}
        exportColumns={FILTER_CHANGE_EXPORT_COLUMNS}
        exportFileName={`filter-changes-${entry.orderNumber}`}
        emptyMessage={tMember("noFilterChangeHistory")}
        canAdd
        onAdd={() => setFilterFormOpen(true)}
      />

      <OrderRelatedSection
        title={tMember("collectionsSection")}
        icon={Banknote}
        data={orderCollections}
        dateKey="collectionDate"
        columns={collectionsColumns}
        exportColumns={COLLECTIONS_EXPORT_COLUMNS}
        exportFileName={`collections-${entry.orderNumber}`}
        emptyMessage={tMember("noCollectionHistory")}
        canAdd
        onAdd={() => setCollectionFormOpen(true)}
      />

      <OrderRelatedSection
        title={tMember("repairsSection")}
        icon={Wrench}
        data={orderRepairs}
        columns={repairColumns}
        exportColumns={REPAIR_EXPORT_COLUMNS}
        exportFileName={`repairs-${entry.orderNumber}`}
        emptyMessage={tMember("noRepairHistory")}
        canAdd
        onAdd={() => setRepairFormOpen(true)}
      />

      <FilterChangeFormDialog
        open={filterFormOpen}
        onOpenChange={setFilterFormOpen}
        defaultDate={today()}
        defaultOrderNumber={entry.orderNumber}
      />
      <CollectionsFormDialog
        open={collectionFormOpen}
        onOpenChange={setCollectionFormOpen}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
      />
      <RepairFormDialog
        open={repairFormOpen}
        onOpenChange={setRepairFormOpen}
        defaultDate={today()}
        defaultOrderNo={entry.orderNumber}
      />
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 mb-1">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="font-medium break-words">{value}</div>
    </div>
  )
}
