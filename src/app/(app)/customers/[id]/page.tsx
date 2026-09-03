"use client"

import * as React from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Mail,
  MapPin,
  Phone,
  Pencil,
  Wrench,
  CalendarDays,
  Building2,
  QrCode,
  Droplet,
  Hash,
  Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ContractStatusBadge } from "@/components/shared/status-badge"
import { LastEditedIndicator } from "@/components/shared/last-edited-indicator"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { CustomerQrDialog } from "@/components/customers/customer-qr-dialog"
import { MemberDirectionsDialog } from "@/components/customers/member-directions-dialog"
import { SaleListFormDialog } from "@/components/sale-list/sale-list-form-dialog"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { CustomerQrCanvas, getScanUrl } from "@/components/customers/customer-qr-code"
import { getSaleListColumns, getSaleListRowClassName, type SaleListRow } from "@/components/sale-list/sale-list-columns"
import { useCustomer, useUpdateCustomer } from "@/lib/hooks/use-customers"
import { updateCustomerCoordinates } from "@/lib/api/customers"
import { useSaleListEntries, useDeleteSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useSettings } from "@/lib/hooks/use-misc"
import { updateSettingsCoordinates } from "@/lib/api/misc"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, getContractStatus, initials } from "@/lib/utils"
import { getServiceHistory } from "@/lib/service-history"
import { DISPENSER_TYPES, TECHNICIANS } from "@/lib/constants"

const TECHNICIAN_NA = "N/A"

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user, can } = useAuth()
  const { t } = useTranslation("member")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: customer, isPending } = useCustomer(params.id)
  const { data: settings } = useSettings()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const updateCustomer = useUpdateCustomer()
  const [editOpen, setEditOpen] = React.useState(false)
  const [qrOpen, setQrOpen] = React.useState(false)
  const [directionsOpen, setDirectionsOpen] = React.useState(false)
  // Set by the row's own Edit icon — opens SaleListFormDialog in edit mode.
  const [editingRow, setEditingRow] = React.useState<SaleListRow | undefined>(undefined)
  // Set by the row's own Delete icon.
  const [deletingRow, setDeletingRow] = React.useState<SaleListRow | undefined>(undefined)
  const deleteEntries = useDeleteSaleListEntries()
  const qrCanvasRef = React.useRef<HTMLCanvasElement>(null)
  // Resolved client-side only (window.location.origin, same as the printable-
  // card dialog) — computing this inline during render would disagree between
  // the server render (no window) and the client's first render, causing a
  // hydration mismatch. params.id is used rather than customer.id so this
  // doesn't have to wait on the customer query to resolve.
  const [scanUrl, setScanUrl] = React.useState("")
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScanUrl(getScanUrl(params.id))
  }, [params.id])
  const [technicianOpen, setTechnicianOpen] = React.useState(false)
  const [technicianDraft, setTechnicianDraft] = React.useState(TECHNICIAN_NA)
  const [installedDateOpen, setInstalledDateOpen] = React.useState(false)
  const [installedDateDraft, setInstalledDateDraft] = React.useState("")
  const [orderNumberOpen, setOrderNumberOpen] = React.useState(false)
  const [orderNumberDraft, setOrderNumberDraft] = React.useState("")
  const [dispenserOpen, setDispenserOpen] = React.useState(false)
  const [dispenserDraft, setDispenserDraft] = React.useState("")
  const isAdmin = user?.role === "admin"

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
        <p className="text-lg font-medium">{t("memberNotFound")}</p>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          {t("backToMember")}
        </Button>
      </div>
    )
  }

  const status = getContractStatus(customer.contractEnd)
  const serviceHistory = getServiceHistory(customer)

  const relatedSales: SaleListRow[] = saleListEntries
    .filter((e) => e.customerId === customer.id || e.orderNumber === customer.orderNumber)
    .map((e) => ({ ...e, accountLabel: customer.companyName || customer.fullName }))
  const saleListColumns = getSaleListColumns({
    canEdit: can("sales:edit"),
    canDelete: can("sales:delete"),
    onEdit: setEditingRow,
    onDelete: setDeletingRow,
  })

  const orderNumber = customer.orderNumber
  function handleDownloadQr() {
    const dataUrl = qrCanvasRef.current?.toDataURL("image/png")
    if (!dataUrl) return
    const a = document.createElement("a")
    a.href = dataUrl
    a.download = `${orderNumber}-qr.png`
    a.click()
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push("/customers")}>
        <ArrowLeft className="h-4 w-4" /> {t("backToMember")}
      </Button>

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
              <ContractStatusBadge status={status} />
            </div>
            {customer.companyName && <p className="text-sm text-muted-foreground">{customer.companyName}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              {t("memberIdLabel")} <span className="font-mono">{customer.id}</span> &middot; {t("registered")}{" "}
              {formatDate(customer.createdAt)}
            </p>
            <LastEditedIndicator entityType="customers" entityId={customer.id} className="text-xs text-muted-foreground mt-0.5" />
          </div>
          <div className="flex items-center gap-3">
            {/* Persistent on the page itself (not just inside the printable-card
                dialog below) — same scan link/QR generation, just always visible. */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="rounded-md border bg-white p-1.5">
                <CustomerQrCanvas ref={qrCanvasRef} value={scanUrl} size={256} style={{ width: 72, height: 72 }} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title={t("downloadQr")}
                onClick={handleDownloadQr}
                disabled={!scanUrl}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => setQrOpen(true)}>
                <QrCode className="h-4 w-4" /> {tCommon("qrCode")}
              </Button>
              <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" /> {tCommon("edit")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="personal">
        <TabsList className="flex-wrap h-auto group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="personal">{t("personalInfo")}</TabsTrigger>
          <TabsTrigger value="service">{t("serviceHistory")}</TabsTrigger>
          <TabsTrigger value="sales">{t("relatedSales")}</TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap gap-2">
          <Popover
            open={orderNumberOpen}
            onOpenChange={(open) => {
              setOrderNumberOpen(open)
              if (open) setOrderNumberDraft(customer.orderNumber)
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Hash className="h-4 w-4" /> {t("orderHash", { value: customer.orderNumber })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">{tFields("orderNumber")}</p>
              {isAdmin ? (
                <div className="space-y-3">
                  <Input
                    value={orderNumberDraft}
                    onChange={(e) => setOrderNumberDraft(e.target.value)}
                    placeholder="e.g. SK001-0016"
                    className="font-mono"
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={updateCustomer.isPending || !orderNumberDraft.trim()}
                    onClick={async () => {
                      const next = orderNumberDraft.trim()
                      if (!next || next === customer.orderNumber) {
                        setOrderNumberOpen(false)
                        return
                      }
                      try {
                        await updateCustomer.mutateAsync({ id: customer.id, input: { orderNumber: next } })
                        setOrderNumberOpen(false)
                      } catch {
                        // Duplicate/other errors are surfaced by the hook's error toast;
                        // keep the popover open so the admin can correct the value.
                      }
                    }}
                  >
                    {updateCustomer.isPending ? tCommon("saving") : tCommon("save")}
                  </Button>
                </div>
              ) : (
                <InfoRow icon={Hash} label={tFields("orderNumber")} value={customer.orderNumber} />
              )}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Building2 className="h-4 w-4" /> {t("companyContact")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <p className="text-sm font-semibold mb-3">{t("companyContactDetails", { company: settings?.companyName ?? t("company") })}</p>
              <div className="space-y-3">
                <InfoRow icon={MapPin} label={t("location")} value={settings?.address || tCommon("notAvailable")} />
                {(settings?.contactNumbers ?? []).map((entry, i) => (
                  <InfoRow key={`num-${i}`} icon={Phone} label={entry.label} value={entry.value} />
                ))}
                {(settings?.contactEmails ?? []).map((entry, i) => (
                  <InfoRow key={`email-${i}`} icon={Mail} label={entry.label} value={entry.value} />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Popover
            open={technicianOpen}
            onOpenChange={(open) => {
              setTechnicianOpen(open)
              if (open) setTechnicianDraft(customer.assignedTechnician || TECHNICIAN_NA)
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Wrench className="h-4 w-4" /> {t("technician")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">{t("assignedTechnician")}</p>
              {isAdmin ? (
                <div className="space-y-3">
                  <Select value={technicianDraft} onValueChange={setTechnicianDraft}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TECHNICIANS.map((tech) => (
                        <SelectItem key={tech} value={tech}>
                          {tech}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={updateCustomer.isPending}
                    onClick={async () => {
                      await updateCustomer.mutateAsync({
                        id: customer.id,
                        input: { assignedTechnician: technicianDraft === TECHNICIAN_NA ? "" : technicianDraft },
                      })
                      setTechnicianOpen(false)
                    }}
                  >
                    {updateCustomer.isPending ? tCommon("saving") : tCommon("save")}
                  </Button>
                </div>
              ) : (
                <InfoRow icon={Wrench} label={tFields("name")} value={customer.assignedTechnician || tCommon("notAvailable")} />
              )}
            </PopoverContent>
          </Popover>
          <Popover
            open={installedDateOpen}
            onOpenChange={(open) => {
              setInstalledDateOpen(open)
              if (open) setInstalledDateDraft(customer.installedDate ?? "")
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <CalendarDays className="h-4 w-4" /> {tFields("installedDate")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">{tFields("installedDate")}</p>
              {isAdmin ? (
                <div className="space-y-3">
                  <Input
                    type="date"
                    value={installedDateDraft}
                    onChange={(e) => setInstalledDateDraft(e.target.value)}
                  />
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={updateCustomer.isPending}
                    onClick={async () => {
                      await updateCustomer.mutateAsync({
                        id: customer.id,
                        input: { installedDate: installedDateDraft || undefined },
                      })
                      setInstalledDateOpen(false)
                    }}
                  >
                    {updateCustomer.isPending ? tCommon("saving") : tCommon("save")}
                  </Button>
                </div>
              ) : (
                <InfoRow
                  icon={CalendarDays}
                  label={t("date")}
                  value={customer.installedDate ? formatDate(customer.installedDate) : tCommon("notAvailable")}
                />
              )}
            </PopoverContent>
          </Popover>
          <Popover
            open={dispenserOpen}
            onOpenChange={(open) => {
              setDispenserOpen(open)
              if (open) setDispenserDraft(DISPENSER_TYPES.includes(customer.dispenserType as (typeof DISPENSER_TYPES)[number]) ? customer.dispenserType : "")
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Droplet className="h-4 w-4" /> {t("waterPurificationType")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">{t("waterPurificationType")}</p>
              {isAdmin ? (
                <div className="space-y-3">
                  <Select value={dispenserDraft} onValueChange={setDispenserDraft}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("selectType")} />
                    </SelectTrigger>
                    <SelectContent>
                      {DISPENSER_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={updateCustomer.isPending || !dispenserDraft}
                    onClick={async () => {
                      if (!dispenserDraft || dispenserDraft === customer.dispenserType) {
                        setDispenserOpen(false)
                        return
                      }
                      await updateCustomer.mutateAsync({
                        id: customer.id,
                        input: { dispenserType: dispenserDraft },
                      })
                      setDispenserOpen(false)
                    }}
                  >
                    {updateCustomer.isPending ? tCommon("saving") : tCommon("save")}
                  </Button>
                </div>
              ) : (
                <InfoRow icon={Droplet} label={t("waterPurificationType")} value={customer.dispenserType || tCommon("notAvailable")} />
              )}
            </PopoverContent>
          </Popover>
        </div>

        <TabsContent value="personal">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("personalInformation")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow icon={Mail} label={t("emailAddress")} value={customer.email} />
              <InfoRow icon={Phone} label={tFields("contactNumber")} value={customer.contactNumber} />
              <InfoRow
                icon={MapPin}
                label={tFields("address")}
                className="sm:col-span-2"
                value={
                  customer.address ? (
                    <button
                      type="button"
                      onClick={() => setDirectionsOpen(true)}
                      title={t("getDirectionsTitle")}
                      className="text-left text-primary hover:underline"
                    >
                      {customer.address}
                    </button>
                  ) : (
                    tCommon("notAvailable")
                  )
                }
              />
              <InfoRow icon={Droplet} label={t("waterPurificationType")} value={customer.dispenserType} />
              <InfoRow
                icon={CalendarDays}
                label={tFields("installedDate")}
                value={customer.installedDate ? formatDate(customer.installedDate) : tCommon("notAvailable")}
              />
              <InfoRow icon={Droplet} label={t("waterFilterInstalled")} value={customer.filterInstalled ? tCommon("yes") : tCommon("no")} />
              <InfoRow icon={Wrench} label={t("assignedTechnician")} value={customer.assignedTechnician || tCommon("notAvailable")} />
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

        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("relatedSales")}</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={saleListColumns}
                data={relatedSales}
                searchPlaceholder={t("searchByOrderNumber")}
                emptyMessage={t("noRelatedSales")}
                getRowClassName={getSaleListRowClassName}
                onRowClick={(row) => router.push(`/sale-list/${row.id}`)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      <CustomerQrDialog open={qrOpen} onOpenChange={setQrOpen} customer={customer} />
      <SaleListFormDialog
        open={!!editingRow}
        onOpenChange={(o) => !o && setEditingRow(undefined)}
        entry={editingRow}
        defaultCustomerId={customer.id}
      />
      <MemberDirectionsDialog
        open={directionsOpen}
        onOpenChange={setDirectionsOpen}
        originAddress={settings?.address ?? ""}
        originCoords={
          settings?.latitude != null && settings?.longitude != null
            ? { lat: settings.latitude, lon: settings.longitude }
            : undefined
        }
        onOriginGeocoded={(lat, lon) => updateSettingsCoordinates(lat, lon).catch(() => {})}
        destinationAddress={customer.address}
        destinationCoords={
          customer.latitude != null && customer.longitude != null
            ? { lat: customer.latitude, lon: customer.longitude }
            : undefined
        }
        onDestinationGeocoded={(lat, lon) => updateCustomerCoordinates(customer.id, lat, lon).catch(() => {})}
        destinationLabel={customer.companyName || customer.fullName}
      />
      <ConfirmDialog
        open={!!deletingRow}
        onOpenChange={(o) => !o && setDeletingRow(undefined)}
        title={t("deleteSaleListEntryTitle")}
        description={t("deleteSaleListEntryDescription")}
        loading={deleteEntries.isPending}
        onConfirm={async () => {
          if (!deletingRow) return
          await deleteEntries.mutateAsync([deletingRow.id])
          setDeletingRow(undefined)
        }}
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
      <div className="font-medium">{value}</div>
    </div>
  )
}
