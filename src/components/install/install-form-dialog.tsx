"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DISPENSER_TYPES } from "@/lib/constants"
import { useCreateInstallPlan, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useCreateCustomer, useCustomers } from "@/lib/hooks/use-customers"
import { useCreateSaleListEntry, useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { newMemberDefaults } from "@/lib/customer-defaults"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"
import type { InstallPlan } from "@/lib/types"

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  const money = z.string().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), t("mustBeZeroOrMore"))
  return z.object({
    inputDate: z.string().min(1, t("requiredField", { field: tf("inputDate") })),
    name: z.string().min(1, t("requiredField", { field: tf("name") })),
    address: z.string().optional(),
    contactNumber: z.string().optional(),
    model: z.string().min(1, t("selectField", { field: tf("model") })),
    unitPrice: money,
    cpPrice: money,
    deliveryInstallationFee: money,
    preInstalledDate: z.string().optional(),
    installedDate: z.string().optional(),
    note: z.string().optional(),
    modelDp: z.string().optional(),
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNo") })),
    inOut: z.string().min(1),
    // Transient — never saved onto the install_plans row itself (it has no
    // such column). Only used, on add, as the new Customer's own
    // memberAccountNumber when this order turns out to have no existing
    // customer match (see onSubmit) — optional since it defaults to '' at
    // the database level either way.
    memberAccountNumber: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, plan?: InstallPlan): FormValues {
  if (plan) {
    return {
      inputDate: plan.inputDate,
      name: plan.name,
      address: plan.address,
      contactNumber: plan.contactNumber,
      model: plan.model,
      unitPrice: String(plan.unitPrice),
      cpPrice: String(plan.cpPrice),
      deliveryInstallationFee: String(plan.deliveryInstallationFee),
      preInstalledDate: plan.preInstalledDate ?? "",
      installedDate: plan.installedDate ?? "",
      note: plan.note ?? "",
      modelDp: plan.modelDp ?? "",
      orderNo: plan.orderNo,
      inOut: plan.inOut,
      memberAccountNumber: "",
    }
  }
  return {
    inputDate: defaultDate,
    name: "",
    address: "",
    contactNumber: "",
    model: "",
    unitPrice: "0",
    cpPrice: "0",
    deliveryInstallationFee: "0",
    preInstalledDate: "",
    installedDate: "",
    note: "",
    modelDp: "",
    orderNo: "",
    inOut: "IN",
    memberAccountNumber: "",
  }
}

export function InstallFormDialog({
  open,
  onOpenChange,
  defaultDate,
  plan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Editing an existing plan instead of creating a new one.
  plan?: InstallPlan
}) {
  const isEdit = !!plan
  const createPlan = useCreateInstallPlan()
  const updatePlan = useUpdateInstallPlan()
  const createCustomer = useCreateCustomer()
  const createSaleListEntry = useCreateSaleListEntry()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { t } = useTranslation("install")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, plan),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, plan))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, plan])

  // See filter-change-form-dialog.tsx's own comment on this same pattern —
  // fills only currently-empty fields, add-only, never overwrites anything
  // already typed.
  function handleOrderNoBlur(orderNo: string) {
    if (isEdit) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, orderNo)
    if (!customer) return
    let filled = false
    const name = customer.companyName || customer.fullName
    if (name && !form.getValues("name").trim()) {
      form.setValue("name", name)
      filled = true
    }
    if (customer.contactNumber && !(form.getValues("contactNumber") ?? "").trim()) {
      form.setValue("contactNumber", customer.contactNumber)
      filled = true
    }
    if (customer.address && !(form.getValues("address") ?? "").trim()) {
      form.setValue("address", customer.address)
      filled = true
    }
    if (filled) toast.success(tCommon("customerInfoFilled"))
  }

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      address: values.address ?? "",
      contactNumber: values.contactNumber ?? "",
      unitPrice: Number(values.unitPrice),
      cpPrice: Number(values.cpPrice),
      deliveryInstallationFee: Number(values.deliveryInstallationFee),
    }
    if (isEdit) {
      await updatePlan.mutateAsync({ id: plan.id, input })
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // see the dispatch_confirmation_workflow migration.
      await createPlan.mutateAsync({ ...input, status: "Pending", dispatchStatus: "Draft" })

      // This order has no existing customer/sale-list-entry match — one
      // form, three records: also create the Member and Sale List entry,
      // instead of leaving the admin to do those as separate steps. Fields
      // with no source in this form (contract number, email, assigned
      // technician, S/C, C/F, C/T, CP Y1/Y2) are left blank/defaulted per
      // the explicit decision on this — never fabricated, admin fills them
      // in later via Edit. Contract start/end are the one exception: those
      // two are NOT NULL columns with no blank option at the database
      // level, so they get the exact same "one year from today" default
      // the Add Member form has always silently used for a brand-new
      // member missing this info (see customer-defaults.ts).
      if (!findCustomerByOrderNumber(customers, saleListEntries, values.orderNo)) {
        const newCustomer = await createCustomer.mutateAsync({
          ...newMemberDefaults(),
          fullName: values.name,
          address: values.address ?? "",
          contactNumber: values.contactNumber ?? "",
          dispenserType: values.model,
          installedDate: values.installedDate || undefined,
          memberAccountNumber: values.memberAccountNumber || "",
          email: "",
        })
        await createSaleListEntry.mutateAsync({
          orderNumber: values.orderNo,
          customerId: newCustomer.id,
          installedDate: values.installedDate || undefined,
          productNo: "",
          sc: "",
          cf: "",
          ct: "",
          cpY1Y2: "",
          status: "ACTIVE",
        })
      }
    }
    onOpenChange(false)
  }

  const pending = createPlan.isPending || updatePlan.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="inputDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("inputDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("name")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("customerOrBusinessName")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{tFields("address")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("installationAddress")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("contactNumber")}</FormLabel>
                    <FormControl>
                      <Input placeholder="09171234567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("model")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("selectField", { field: tFields("model") })} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DISPENSER_TYPES.map((dt) => (
                          <SelectItem key={dt} value={dt}>
                            {dt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("unitPrice")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("cpPrice")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="deliveryInstallationFee"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("deliveryInstallationFee")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preInstalledDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("preInstalledDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="installedDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("installedDate")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{tFields("note")}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder={tCommon("optionalNotes")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="modelDp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("modelDp")}</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {DISPENSER_TYPES.map((dt) => (
                          <SelectItem key={dt} value={dt}>
                            {dt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="orderNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("orderNo")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="001-0001"
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleOrderNoBlur(e.target.value)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="memberAccountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("memberAccount")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("memberAccountNumberHint")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="inOut"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("inOrOut")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="IN">IN</SelectItem>
                        <SelectItem value="OUT">OUT</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : tCommon("add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
