"use client"

import * as React from "react"
import { CheckCircle2, Plus, Settings as SettingsIcon, ShoppingBag, Trash2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminGuard } from "@/components/shared/admin-guard"
import { useSettings, useUpdateSettings } from "@/lib/hooks/use-misc"
import { useShopifyStatus } from "@/lib/hooks/use-shopify"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDateTime } from "@/lib/utils"
import { DISPENSER_TYPES } from "@/lib/constants"
import type { ContactEntry } from "@/lib/types"

// Reads ?shopify=connected|error&shopify_message=... left by the OAuth
// callback redirect. Read via window.location instead of useSearchParams()
// so this client-only banner doesn't force a Suspense boundary onto an
// otherwise fully client-rendered, admin-gated page.
function useShopifyCallbackBanner() {
  const [banner, setBanner] = React.useState<{ status: "connected" | "error"; message?: string } | null>(null)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get("shopify")
    if (status === "connected" || status === "error") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBanner({ status, message: params.get("shopify_message") ?? undefined })
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])
  return banner
}

function ShopifyIntegrationCard() {
  const { data: status, isPending } = useShopifyStatus()
  const banner = useShopifyCallbackBanner()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <ShoppingBag className="h-4 w-4" /> Shopify Integration
        </CardTitle>
        <CardDescription>
          Connect your Shopify store so new orders automatically deduct stock by SKU.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              banner.status === "connected"
                ? "border-success/20 bg-success/10 text-success"
                : "border-danger/20 bg-danger/10 text-danger"
            }`}
          >
            {banner.status === "connected" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
            )}
            <span>
              {banner.status === "connected"
                ? "Shopify connected successfully. New orders will now deduct stock automatically."
                : banner.message || "Connecting to Shopify failed."}
            </span>
          </div>
        )}

        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : status?.connected ? (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> Connected to {status.shopDomain}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status.installedAt ? `Since ${formatDateTime(status.installedAt)}` : null} · Scopes: {status.scopes}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/api/shopify/install">Reconnect</a>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Not connected</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                No Shopify store is linked yet.
              </p>
            </div>
            <Button size="sm" asChild>
              <a href="/api/shopify/install">Connect to Shopify</a>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ContactEntryList({
  title,
  entries,
  onChange,
  labelPlaceholder,
  valuePlaceholder,
}: {
  title: string
  entries: ContactEntry[]
  onChange: (entries: ContactEntry[]) => void
  labelPlaceholder: string
  valuePlaceholder: string
}) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <div className="space-y-2">
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <Input
              className="w-36"
              placeholder={labelPlaceholder}
              value={entry.label}
              onChange={(e) => onChange(entries.map((it, idx) => (idx === i ? { ...it, label: e.target.value } : it)))}
            />
            <Input
              placeholder={valuePlaceholder}
              value={entry.value}
              onChange={(e) => onChange(entries.map((it, idx) => (idx === i ? { ...it, value: e.target.value } : it)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-danger shrink-0"
              onClick={() => onChange(entries.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...entries, { label: "", value: "" }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { data: settings, isPending } = useSettings()
  const updateSettings = useUpdateSettings(user?.id ?? "")

  const [companyName, setCompanyName] = React.useState("")
  const [logoUrl, setLogoUrl] = React.useState<string | undefined>(undefined)
  const [supportEmail, setSupportEmail] = React.useState("")
  const [emailNotifications, setEmailNotifications] = React.useState(true)
  const [currency, setCurrency] = React.useState("")
  const [taxRate, setTaxRate] = React.useState(0)
  const [address, setAddress] = React.useState("")
  const [contactNumbers, setContactNumbers] = React.useState<ContactEntry[]>([])
  const [contactEmails, setContactEmails] = React.useState<ContactEntry[]>([])
  const [monitoringDefaultMonths, setMonitoringDefaultMonths] = React.useState(6)
  const [monitoringIntervals, setMonitoringIntervals] = React.useState<Record<string, number>>({})
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    // One-time sync from the fetched settings record into editable local form state.
    if (settings) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompanyName(settings.companyName)
      setLogoUrl(settings.companyLogoUrl)
      setSupportEmail(settings.supportEmail)
      setEmailNotifications(settings.emailNotificationsEnabled)
      setCurrency(settings.currency)
      setTaxRate(settings.taxRate)
      setAddress(settings.address)
      setContactNumbers(settings.contactNumbers)
      setContactEmails(settings.contactEmails)
      setMonitoringDefaultMonths(settings.monitoringDefaultMonths)
      setMonitoringIntervals(settings.monitoringIntervals)
    }
  }, [settings])

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setLogoUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  function handleSave() {
    updateSettings.mutate({
      companyName,
      companyLogoUrl: logoUrl,
      supportEmail,
      emailNotificationsEnabled: emailNotifications,
      currency,
      taxRate,
      address,
      contactNumbers,
      contactEmails,
      monitoringDefaultMonths,
      monitoringIntervals,
    })
  }

  function handleIntervalChange(type: string, raw: number) {
    setMonitoringIntervals((prev) => {
      const next = { ...prev }
      // Blank / non-positive means "use the default" — drop the override entirely.
      if (!raw || Number.isNaN(raw) || raw <= 0) delete next[type]
      else next[type] = Math.round(raw)
      return next
    })
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <AdminGuard>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-6 w-6 text-primary" /> Settings
          </h1>
          <p className="text-sm text-muted-foreground">Manage company information, preferences, and data.</p>
        </div>

        <ShopifyIntegrationCard />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company Information</CardTitle>
            <CardDescription>Shown on invoices and throughout the app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={logoUrl} alt="Company logo" />
                <AvatarFallback className="bg-primary text-primary-foreground text-lg">
                  {companyName.slice(0, 2).toUpperCase() || "AT"}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="gap-1.5">
                  <Upload className="h-3.5 w-3.5" /> Upload Logo
                </Button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                <p className="text-xs text-muted-foreground">PNG or JPG, square recommended.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Support Email</Label>
              <Input type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="cursor-pointer">Email Notifications</Label>
                <p className="text-xs text-muted-foreground">Send email alerts for low stock and expiring contracts.</p>
              </div>
              <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Company Contact Details</CardTitle>
            <CardDescription>Our own company&apos;s contact info, shown to staff from customer profiles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Office Address</Label>
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <ContactEntryList
              title="Mobile Numbers"
              entries={contactNumbers}
              onChange={setContactNumbers}
              labelPlaceholder="Department"
              valuePlaceholder="0917 000 0000"
            />
            <ContactEntryList
              title="Email Addresses"
              entries={contactEmails}
              onChange={setContactEmails}
              labelPlaceholder="Department"
              valuePlaceholder="dept@aquatrack.ph"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quarterly Monitoring Intervals</CardTitle>
            <CardDescription>
              How far after the installed date each product&apos;s next monitoring/replacement is due. Used to
              compute the &quot;End Date&quot; and status shown on the customer&apos;s public scan page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-w-xs">
              <Label>Default Interval (months)</Label>
              <Input
                type="number"
                min={1}
                value={monitoringDefaultMonths}
                onChange={(e) => setMonitoringDefaultMonths(Math.max(1, Math.round(e.target.valueAsNumber || 1)))}
              />
              <p className="text-xs text-muted-foreground">Applied to any product type without a specific interval below.</p>
            </div>
            <div className="space-y-2">
              <Label>Per Water Purification Type</Label>
              <div className="space-y-2">
                {DISPENSER_TYPES.map((type) => (
                  <div key={type} className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                    <span className="text-sm">{type}</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        className="w-24"
                        placeholder={`${monitoringDefaultMonths} (default)`}
                        value={monitoringIntervals[type] ?? ""}
                        onChange={(e) => handleIntervalChange(type, e.target.valueAsNumber)}
                      />
                      <span className="text-xs text-muted-foreground w-12">months</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave blank to use the default. E.g. set smaller units to 6 and larger units to 12.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Billing Preferences</CardTitle>
            <CardDescription>Applied to new sales and invoices.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="PHP" />
            </div>
            <div className="space-y-2">
              <Label>Tax Rate (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.valueAsNumber || 0)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </AdminGuard>
  )
}
