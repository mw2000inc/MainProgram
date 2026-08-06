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
import { ContractStatusBadge } from "@/components/shared/status-badge"
import { CustomerFormDialog } from "@/components/customers/customer-form-dialog"
import { CustomerQrDialog } from "@/components/customers/customer-qr-dialog"
import { useCustomer, useUpdateCustomer } from "@/lib/hooks/use-customers"
import { useSettings } from "@/lib/hooks/use-misc"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDate, getContractStatus, initials } from "@/lib/utils"
import { getServiceHistory } from "@/lib/service-history"
import { TECHNICIANS } from "@/lib/constants"

const TECHNICIAN_NA = "N/A"

export default function CustomerProfilePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { data: customer, isPending } = useCustomer(params.id)
  const { data: settings } = useSettings()
  const updateCustomer = useUpdateCustomer(user?.id ?? "")
  const [editOpen, setEditOpen] = React.useState(false)
  const [qrOpen, setQrOpen] = React.useState(false)
  const [technicianOpen, setTechnicianOpen] = React.useState(false)
  const [technicianDraft, setTechnicianDraft] = React.useState(TECHNICIAN_NA)
  const [installedDateOpen, setInstalledDateOpen] = React.useState(false)
  const [installedDateDraft, setInstalledDateDraft] = React.useState("")
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
        <p className="text-lg font-medium">Customer not found</p>
        <Button variant="outline" onClick={() => router.push("/customers")}>
          Back to Customers
        </Button>
      </div>
    )
  }

  const status = getContractStatus(customer.contractEnd)
  const serviceHistory = getServiceHistory(customer)

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.push("/customers")}>
        <ArrowLeft className="h-4 w-4" /> Back to Customers
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
              Customer ID: <span className="font-mono">{customer.id}</span> &middot; Registered{" "}
              {formatDate(customer.createdAt)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-1.5" onClick={() => setQrOpen(true)}>
              <QrCode className="h-4 w-4" /> QR Code
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="personal">
        <TabsList className="flex-wrap h-auto group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="personal">Personal Info</TabsTrigger>
          <TabsTrigger value="service">Service History</TabsTrigger>
        </TabsList>

        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Building2 className="h-4 w-4" /> Company Contact
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <p className="text-sm font-semibold mb-3">{settings?.companyName ?? "Company"} Contact Details</p>
              <div className="space-y-3">
                <InfoRow icon={MapPin} label="Location" value={settings?.address || "N/A"} />
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
                <Wrench className="h-4 w-4" /> Technician
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">Assigned Technician</p>
              {isAdmin ? (
                <div className="space-y-3">
                  <Select value={technicianDraft} onValueChange={setTechnicianDraft}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TECHNICIANS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
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
                    {updateCustomer.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              ) : (
                <InfoRow icon={Wrench} label="Name" value={customer.assignedTechnician || "N/A"} />
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
                <CalendarDays className="h-4 w-4" /> Installed Date
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start">
              <p className="text-sm font-semibold mb-3">Installed Date</p>
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
                    {updateCustomer.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              ) : (
                <InfoRow
                  icon={CalendarDays}
                  label="Date"
                  value={customer.installedDate ? formatDate(customer.installedDate) : "N/A"}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>

        <TabsContent value="personal">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow icon={Mail} label="Email Address" value={customer.email} />
              <InfoRow icon={Phone} label="Contact Number" value={customer.contactNumber} />
              <InfoRow icon={MapPin} label="Address" value={customer.address} className="sm:col-span-2" />
              <InfoRow icon={Droplet} label="Water Purification Type" value={customer.dispenserType} />
              <InfoRow
                icon={CalendarDays}
                label="Installed Date"
                value={customer.installedDate ? formatDate(customer.installedDate) : "N/A"}
              />
              <InfoRow icon={Droplet} label="Water Filter Installed" value={customer.filterInstalled ? "Yes" : "No"} />
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
      </Tabs>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={customer} />
      <CustomerQrDialog open={qrOpen} onOpenChange={setQrOpen} customer={customer} />
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
