"use client"

import * as React from "react"
import { Plus, Settings as SettingsIcon, Trash2, Upload } from "lucide-react"
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
import { useAuth } from "@/lib/auth/auth-context"
import type { ContactEntry } from "@/lib/types"

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
