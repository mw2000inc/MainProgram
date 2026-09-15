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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { CurrencyInput } from "@/components/shared/currency-input"
import { PRODUCT_CATALOG, PAYMENT_METHODS, formatProductOption } from "@/lib/constants"
import { useCreateInstallPlan, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useCreateCustomer, useCustomers } from "@/lib/hooks/use-customers"
import { useCreateSaleListEntry, useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber, findExistingMemberMatch, type MemberMatchField } from "@/lib/customer-lookup"
import { newMemberDefaults } from "@/lib/customer-defaults"
import { dateFieldSchema, moneySchema } from "@/lib/form-schemas"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"
import type { InstallPlan } from "@/lib/types"

// Preset suggestions offered below Model and Model(dp) — still a real text
// input (see the Combobox below), so a custom/unlisted unit name is always
// typable and never rejected. Drawn from the same legacy product catalog
// the Sale List form's own Product# combobox already uses (see that file),
// rather than DISPENSER_TYPES — that list was 100% "SK2 ..." variants,
// explicitly excluded here (and defensively filtered again below in case a
// future catalog addition reintroduces one) since SK2 units are no longer
// offered as a preset. A plan already saved with "SK2 White" etc. still
// displays and remains editable — the Combobox never rejects a value just
// because it isn't in this list.
const MODEL_OPTIONS: ComboboxOption[] = PRODUCT_CATALOG.flatMap((g) =>
  g.items.map((item) => ({ value: formatProductOption(item.code, item.name), group: g.group }))
).filter((opt) => !opt.value.toUpperCase().includes("SK2"))

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  const money = moneySchema(t)
  return z.object({
    inputDate: dateFieldSchema(t, tf("inputDate")),
    name: z.string().min(1, t("requiredField", { field: tf("name") })),
    address: z.string().optional(),
    contactNumber: z.string().optional(),
    model: z.string().min(1, t("selectField", { field: tf("model") })),
    unitPrice: money,
    cpPrice: money,
    deliveryInstallationFee: money,
    preInstalledDate: dateFieldSchema(t),
    installedDate: dateFieldSchema(t),
    note: z.string().optional(),
    modelDp: z.string().optional(),
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNo") })),
    inOut: z.string().min(1),
    // AppSheet's own SalesSchedule form fields — genuinely new, not tracked
    // anywhere else on this record before (20260923000000 migration).
    paymentMode: z.string().optional(),
    receiptNo: z.string().optional(),
    salesPerson: z.string().optional(),
    via: z.string().optional(),
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
      paymentMode: plan.paymentMode ?? "",
      receiptNo: plan.receiptNo ?? "",
      salesPerson: plan.salesPerson ?? "",
      via: plan.via ?? "",
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
    paymentMode: "",
    receiptNo: "",
    salesPerson: "",
    via: "",
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

  // Same add-only autofill as handleOrderNoBlur above, but keyed off Name /
  // Member Account# / Contact # instead of Order No. — reuses
  // findExistingMemberMatch (the same exact-match lookup the Add Member form
  // uses to detect "this is probably already an existing member"), searching
  // only on whichever one field just lost focus so a half-typed value in
  // another field can't cause a false match. Fills every other field this
  // form has that also lives on the Customer record, including the unit
  // Model (from the customer's own dispenserType) — the closest thing to a
  // "standard unit" this app tracks per customer — but only ever into fields
  // still empty, exactly like handleOrderNoBlur.
  function handleCustomerLookupBlur(source: MemberMatchField, value: string) {
    if (isEdit) return
    if (!value.trim()) return
    const match = findExistingMemberMatch(customers, {
      fullName: source === "name" ? value : undefined,
      companyName: source === "name" ? value : undefined,
      contactNumber: source === "contactNumber" ? value : undefined,
      memberAccountNumber: source === "memberAccountNumber" ? value : undefined,
    })
    if (!match) return
    const customer = match.customer
    let filled = false
    const name = customer.companyName || customer.fullName
    if (name && !form.getValues("name").trim()) {
      form.setValue("name", name)
      filled = true
    }
    if (customer.address && !(form.getValues("address") ?? "").trim()) {
      form.setValue("address", customer.address)
      filled = true
    }
    if (customer.contactNumber && !(form.getValues("contactNumber") ?? "").trim()) {
      form.setValue("contactNumber", customer.contactNumber)
      filled = true
    }
    if (customer.memberAccountNumber && !(form.getValues("memberAccountNumber") ?? "").trim()) {
      form.setValue("memberAccountNumber", customer.memberAccountNumber)
      filled = true
    }
    if (customer.dispenserType && !form.getValues("model").trim()) {
      form.setValue("model", customer.dispenserType)
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
      // see the dispatch_confirmation_workflow migration. serviceman starts
      // unassigned — the admin picks one from the Pending Approvals dialog's
      // own Technician dropdown before approving, same as every other module.
      await createPlan.mutateAsync({ ...input, status: "Pending", dispatchStatus: "Draft", serviceman: "" })

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
              {/* Field order below matches AppSheet's own SalesSchedule form
                  layout exactly: Input Date, Order No, Name, Address,
                  Contact #, In or Out, Model, Unit price, C/P price,
                  Delivery & Installation Fee, Payment Mode, Receipt #, Pre
                  Installed Date, Installed Date, Sales Person, Via, Note,
                  Model(dp). Member Account# at the very end is this app's
                  own addition (see its own comment below), not part of that
                  external layout. */}
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
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("name")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("customerOrBusinessName")}
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleCustomerLookupBlur("name", e.target.value)
                        }}
                      />
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
                      <Input
                        placeholder="09171234567"
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleCustomerLookupBlur("contactNumber", e.target.value)
                        }}
                      />
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
                    {/* Segmented IN/OUT toggle instead of a Select — only two
                        mutually exclusive options, so a pair of joined
                        buttons reads faster than opening a dropdown. */}
                    <div className="flex w-fit">
                      <Button
                        type="button"
                        variant={field.value === "IN" ? "default" : "outline"}
                        className="rounded-r-none"
                        onClick={() => field.onChange("IN")}
                      >
                        IN
                      </Button>
                      <Button
                        type="button"
                        variant={field.value === "OUT" ? "default" : "outline"}
                        className="-ml-px rounded-l-none"
                        onClick={() => field.onChange("OUT")}
                      >
                        OUT
                      </Button>
                    </div>
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
                    <FormControl>
                      {/* Free-text combobox, not a strict Select — a custom
                          unit/model name is always typable, with
                          MODEL_OPTIONS offered as suggestions below it. */}
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={MODEL_OPTIONS}
                        placeholder={t("selectField", { field: tFields("model") })}
                      />
                    </FormControl>
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
                      <CurrencyInput {...field} />
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
                      <CurrencyInput {...field} />
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
                      <CurrencyInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("paymentMode")}</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
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
                name="receiptNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("receiptNo")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                name="salesPerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("salesPerson")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="via"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("via")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormControl>
                      {/* Free-text combobox like Model above — clearing it is
                          just erasing the text, so no "none" sentinel is
                          needed the way the old Select required. */}
                      <Combobox value={field.value ?? ""} onChange={field.onChange} options={MODEL_OPTIONS} placeholder="—" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* Not part of AppSheet's own SalesSchedule layout — this
                  app's own addition so a brand-new customer (no existing
                  order match, see onSubmit) can get a real Member Account#
                  set at creation instead of defaulting to blank. */}
              <FormField
                control={form.control}
                name="memberAccountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("memberAccount")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("memberAccountNumberHint")}
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleCustomerLookupBlur("memberAccountNumber", e.target.value)
                        }}
                      />
                    </FormControl>
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
