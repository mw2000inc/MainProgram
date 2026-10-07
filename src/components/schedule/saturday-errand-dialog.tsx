"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { TechnicianCombobox } from "@/components/shared/technician-combobox"
import { createScheduleJob } from "@/lib/api/schedule"
import { scheduleJobsKey } from "@/lib/hooks/use-schedule"
import { useUsers } from "@/lib/hooks/use-misc"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { VEHICLE_TYPES } from "@/lib/constants"
import { isSaturday } from "@/lib/schedule-timeframe"
import { assignmentAccounts, crewForVehicle, isAssignedTechnician, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"

const NONE = "__none"

// "+ Add Errand" on the Saturday banner: a non-visit task (pick up filter
// stock, a payment collection, a warehouse audit) put straight onto a
// Saturday. Saved as a schedule job of type "other" — the app's errand type
// (the same one the Auto-suggest dialog creates): no Filter Change / install
// / repair / collection record behind it, the description in Notes and the
// instructions in Remarks. With a technician it's active at once (an admin
// assigning a Saturday by hand); without one it waits in that Saturday's
// coverage list ('pending_approval') like any unassigned Saturday job.
export function SaturdayErrandDialog({
  open,
  onOpenChange,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
}) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const qc = useQueryClient()
  const { data: users = [] } = useUsers()
  const accounts = React.useMemo(() => assignmentAccounts(users), [users])
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()

  const [date, setDate] = React.useState(defaultDate)
  const [technician, setTechnician] = React.useState("")
  const [technician2, setTechnician2] = React.useState("")
  const [vehicle, setVehicle] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [notes, setNotes] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  // A blank form every time it opens, on the Saturday in view.
  const [wasOpen, setWasOpen] = React.useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDate(defaultDate)
      setTechnician("")
      setTechnician2("")
      setVehicle("")
      setTitle("")
      setAddress("")
      setNotes("")
    }
  }

  const pickVehicle = (value: string) => {
    const v = value === NONE ? "" : value
    setVehicle(v)
    const crew = crewForVehicle(v)
    if (crew) {
      setTechnician(crew.primary)
      setTechnician2(crew.secondary)
    }
  }

  // An Errand that's a customer's order number (e.g. 001-0096): on blur, the
  // same order lookup as the Filter Change form's Order Number fills the
  // Address and a short Notes line (name · phone · order) — only fields still
  // blank, so nothing the admin typed is ever overwritten. The Errand text is
  // kept as typed; free text matches nothing and fills nothing.
  function handleErrandBlur() {
    const order = title.trim()
    const customer = findCustomerByOrderNumber(customers, saleListEntries, order)
    if (!customer) return
    const name = customer.companyName || customer.fullName
    let filled = false
    if (customer.address?.trim() && !address.trim()) {
      setAddress(customer.address.trim())
      filled = true
    }
    const line = [name, customer.contactNumber?.trim(), t("errandOrderNote", { order })].filter(Boolean).join(" · ")
    if (!notes.trim()) {
      setNotes(line)
      filled = true
    }
    if (filled) toast.success(t("errandCustomerFilled", { name: name || order }))
  }

  const assigned = isAssignedTechnician(technician)
  const canSave = !!date && title.trim().length > 0 && !saving

  async function save() {
    setSaving(true)
    try {
      const pair = assigned ? normalizeTechnicianPair(technician, technician2) : { primary: "", secondary: "" }
      await createScheduleJob({
        jobType: "other",
        status: assigned ? "pending" : "pending_approval",
        scheduledDate: date,
        technician: pair.primary,
        technician2: pair.secondary,
        ...technicianAccountIds(pair.primary, pair.secondary, accounts),
        vehicle,
        secondaryAddress: address.trim() || undefined,
        notes: title.trim(),
        remarks: notes.trim() || undefined,
      })
      qc.invalidateQueries({ queryKey: scheduleJobsKey })
      toast.success(assigned ? t("errandAdded", { technician: pair.primary }) : t("errandAddedUnassigned"))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg" data-testid="saturday-errand-dialog">
        <DialogHeader>
          <DialogTitle>{t("errandTitle")}</DialogTitle>
          <DialogDescription>{t("saturdayErrandDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="errand-date">{t("errandDate")}</Label>
            <Input id="errand-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="errand-date" />
            {date && !isSaturday(date) && <p className="text-xs text-warning">{t("errandNotSaturday")}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="errand-title">{t("errandWhat")}</Label>
            <Input
              id="errand-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleErrandBlur}
              placeholder={t("errandWhatPlaceholder")}
              data-testid="errand-title"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("technician")}</Label>
            <TechnicianCombobox value={technician} onChange={setTechnician} placeholder={t("errandTechnicianPlaceholder")} />
            {!assigned && <p className="text-xs text-muted-foreground">{t("errandUnassignedHint")}</p>}
          </div>
          {assigned && (
            <div className="grid gap-1.5">
              <Label>{t("secondTechnicianOptional")}</Label>
              <TechnicianCombobox value={technician2} onChange={setTechnician2} includeNotApplicable={false} exclude={technician} />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>{t("vehicleOptional")}</Label>
            <Select value={vehicle || NONE} onValueChange={pickVehicle}>
              <SelectTrigger className="w-full" data-testid="errand-vehicle">
                <SelectValue placeholder={t("selectVehicle")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{tCommon("none")}</SelectItem>
                {VEHICLE_TYPES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="errand-address">{t("errandAddress")}</Label>
            <Input id="errand-address" value={address} onChange={(e) => setAddress(e.target.value)} data-testid="errand-address" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="errand-notes">{t("errandNotes")}</Label>
            <Textarea id="errand-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="errand-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" disabled={!canSave} onClick={save} data-testid="errand-save">
            {t("errandSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
