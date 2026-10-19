"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
  CollectedAttributionFields,
  collectedAttributionDefaults,
  collectedAttributionPatch,
} from "@/components/shared/collected-attribution-fields"
import { PRODUCT_CATALOG, PAYMENT_METHODS, formatProductOption } from "@/lib/constants"
import { SecondTechnicianFormItem, TechnicianCombobox } from "@/components/shared/technician-combobox"
import { normalizeTechnicianPair } from "@/lib/technicians"
import { useVisitDraftJob } from "@/lib/scheduling/use-visit-draft-job"
import { useCreateInstallPlan, useInstallPlans, useUpdateInstallPlan } from "@/lib/hooks/use-install-plans"
import { useCreateCustomer, useCustomers } from "@/lib/hooks/use-customers"
import { useCreateSaleListEntry, useSaleListEntries, useUpdateSaleListEntry } from "@/lib/hooks/use-sale-list"
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
    // The member's email — filled from the order; saved as this install's
    // confirmation email (notify_email) and used for a new member's record.
    email: z.string().trim().optional(),
    model: z.string().min(1, t("selectField", { field: tf("model") })),
    unitPrice: money,
    cpPrice: money,
    deliveryInstallationFee: money,
    preInstalledDate: dateFieldSchema(t),
    installedDate: dateFieldSchema(t),
    note: z.string().optional(),
    modelDp: z.string().optional(),
    // No longer required — install_plans.order_no is NOT NULL but has no
    // default, and the API layer passes this straight through with no ""
    // -> null conversion (see toRow in install-plans.ts), so an empty
    // string here satisfies that constraint fine; nothing downstream
    // assumes a non-blank value.
    orderNo: z.string().optional(),
    // Not on the form any more: a new installation is OUT; an edited one keeps
    // what it has (blank → OUT on save).
    inOut: z.string(),
    // AppSheet's own SalesSchedule form fields — genuinely new, not tracked
    // anywhere else on this record before (20260923000000 migration).
    paymentMode: z.string().optional(),
    receiptNo: z.string().optional(),
    salesPerson: z.string().optional(),
    via: z.string().optional(),
    // Optional here, unlike Repair Plan's own required Technician field —
    // install_plans.serviceman has always been left blank at creation and
    // assigned later from the Pending Approvals dialog's own Technician
    // dropdown (see onSubmit's own comment); this doesn't change that
    // workflow, it just lets an admin who already knows who's doing the job
    // set it now instead of waiting for that later step. Trimmed, since it's
    // now a typable field (see TechnicianCombobox).
    serviceman: z.string().trim().optional(),
    serviceman2: z.string().trim().optional(),
    // Saved on the install_plans row itself (20261007000000 migration) so the
    // detail card and member grouping show exactly what was typed, on add and
    // on edit. On add it is ALSO used as the new Customer's own
    // memberAccountNumber when this order turns out to have no existing
    // customer match (see onSubmit) — optional since it defaults to '' at
    // the database level either way.
    memberAccountNumber: z.string().optional(),
    collectedBy: z.string().optional(),
    collectedAt: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNo?: string, plan?: InstallPlan): FormValues {
  if (plan) {
    return {
      inputDate: plan.inputDate,
      name: plan.name,
      address: plan.address,
      contactNumber: plan.contactNumber,
      email: plan.notifyEmail ?? "",
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
      serviceman: plan.serviceman ?? "",
      serviceman2: plan.serviceman2 ?? "",
      memberAccountNumber: plan.memberAccountNumber ?? "",
      ...collectedAttributionDefaults(plan),
    }
  }
  return {
    inputDate: defaultDate,
    name: "",
    address: "",
    contactNumber: "",
    email: "",
    model: "",
    unitPrice: "0",
    cpPrice: "0",
    deliveryInstallationFee: "0",
    preInstalledDate: "",
    installedDate: "",
    note: "",
    modelDp: "",
    orderNo: defaultOrderNo ?? "",
    // OUT by default (admin, 2026-10-16) — an installation's unit leaves
    // stock; its Inventory movement is always OUT (queue_install_inventory).
    inOut: "OUT",
    paymentMode: "",
    receiptNo: "",
    salesPerson: "",
    via: "",
    serviceman: "",
    serviceman2: "",
    memberAccountNumber: "",
    ...collectedAttributionDefaults(),
  }
}

export function InstallFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNo,
  plan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order No. when opened from an order's own detail page — same
  // add-only autofill as Filter Change/Collection/Repair's own
  // defaultOrderNo (see handleOrderNoBlur below, fired once on open).
  defaultOrderNo?: string
  // Editing an existing plan instead of creating a new one.
  plan?: InstallPlan
}) {
  const isEdit = !!plan
  const createPlan = useCreateInstallPlan()
  const updatePlan = useUpdateInstallPlan()
  const createCustomer = useCreateCustomer()
  const createSaleListEntry = useCreateSaleListEntry()
  const updateSaleListEntry = useUpdateSaleListEntry()
  const ensureVisitDraftJob = useVisitDraftJob()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: installPlans = [] } = useInstallPlans()
  const { t } = useTranslation("install")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNo, plan),
  })
  const servicemanValue = form.watch("serviceman")

  // Read-only, never submitted — install_plans has no column for this at
  // all (per the explicit decision on this: purely a display convenience,
  // not a new stored field). Same plain "YYYY-MM" slice the yearMonth()
  // helpers on Collection Plan/Filter Change/Sale List's order view already
  // compute client-side from their own date fields, just shown live in the
  // form itself instead of used for a sidebar filter.
  const inputDateValue = form.watch("inputDate")
  const yearMonthPlan = inputDateValue ? inputDateValue.slice(0, 7) : ""

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNo, plan))
    // Same immediate-fill-on-open as Filter Change/Collection/Repair's own
    // defaultOrderNo — opening this dialog already pointed at a real order
    // (e.g. from that order's own detail page) fills the rest in right away,
    // without needing the admin to click into and back out of a field that's
    // already correctly filled.
    if (!plan && defaultOrderNo) handleOrderNoBlur(defaultOrderNo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNo, plan])

  // Entering an Order No. fills in what the database already knows about
  // that order — add-only, and only into fields still empty (a price of 0
  // counts as empty), so nothing already typed is overwritten:
  //   - Name, Member Account#, Address, Contact #, Email: the order's member;
  //   - Model: the order's Sale List Product #, else the most recent earlier
  //     install of this order, else the member's unit;
  //   - Unit Price, C/P Price, D&I, Payment Mode: the most recent earlier
  //     install of this order (Sale List has no prices; an order installed
  //     for the first time has none to copy, so those stay to be typed).
  // Without a member, the earlier install's name / address / contact are used.
  function handleOrderNoBlur(orderNo: string) {
    if (isEdit) return
    const order = orderNo.trim()
    if (!order) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, order)
    const entry = saleListEntries.find((e) => e.orderNumber.trim() === order)
    const previous = installPlans
      .filter((p) => p.orderNo.trim() === order)
      .sort((a, b) => (b.inputDate ?? "").localeCompare(a.inputDate ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]
    if (!customer && !entry && !previous) {
      toast.info(t("orderNotFound"))
      return
    }
    let filled = false
    const fillText = (field: "name" | "address" | "contactNumber" | "email" | "memberAccountNumber" | "model" | "paymentMode", value: string | undefined) => {
      if (value?.trim() && !(form.getValues(field) ?? "").trim()) {
        form.setValue(field, value.trim(), { shouldValidate: form.formState.isSubmitted })
        filled = true
      }
    }
    const fillMoney = (field: "unitPrice" | "cpPrice" | "deliveryInstallationFee", value: number | undefined) => {
      const current = Number(form.getValues(field) || 0)
      if (value && !current) {
        form.setValue(field, String(value), { shouldValidate: form.formState.isSubmitted })
        filled = true
      }
    }
    fillText("name", customer ? customer.companyName || customer.fullName : previous?.name)
    fillText("memberAccountNumber", customer?.memberAccountNumber || previous?.memberAccountNumber)
    fillText("address", customer?.address || previous?.address)
    fillText("contactNumber", customer?.contactNumber || previous?.contactNumber)
    fillText("email", customer?.email || previous?.notifyEmail)
    fillText("model", entry?.productNo || previous?.model || customer?.dispenserType)
    fillMoney("unitPrice", previous?.unitPrice)
    fillMoney("cpPrice", previous?.cpPrice)
    fillMoney("deliveryInstallationFee", previous?.deliveryInstallationFee)
    fillText("paymentMode", previous?.paymentMode)
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

  // Approval first: an installation with a date gets its draft schedule job
  // (see useVisitDraftJob) — on the Pre Installed Date, else the Installed Date.
  const ensureDraftJob = (planId: string, existingJobId: string | undefined, values: FormValues) =>
    ensureVisitDraftJob({
      table: "install_plans",
      jobType: "installation",
      recordId: planId,
      existingJobId,
      date: values.preInstalledDate || values.installedDate,
      orderNo: values.orderNo,
      address: values.address,
      technician: values.serviceman,
      technician2: values.serviceman2,
      notes: [values.name, values.model].filter(Boolean).join(" — "),
    })

  // One form, three records: an installation's order also gets its Member and
  // its Sale List entry, so Repair / Filter Change / Collection forms for the
  // order fill in from them later (findCustomerByOrderNumber). Add-only —
  // nothing already there is overwritten:
  // - Member: the order's own (via its Sale List entry or the member's order
  //   field), else an existing member matching the Account# / phone / name
  //   (findExistingMemberMatch, the same check as the live autofill — a typed
  //   existing Account# must link, not hit the unique-constraint error),
  //   else a new member from this form. Fields with no source here (contract
  //   no., S/C, C/F, C/T, CP Y1/Y2…) stay blank for the admin to fill in;
  //   contract start/end get the Add Member form's one-year default
  //   (customer-defaults.ts) since they can't be blank.
  // - Sale List: a new entry for the order (Product # = the unit Model,
  //   installed date, the member) when the order has none; an existing entry
  //   only gets a missing Product # / member / installed date filled in. An
  //   installation without an Order No. gets no Sale List entry.
  async function ensureMemberAndSaleEntry(values: FormValues, orderNo: string) {
    const order = orderNo.trim()
    const sale = order ? saleListEntries.find((e) => e.orderNumber.trim() === order) : undefined
    let customerId = order ? findCustomerByOrderNumber(customers, saleListEntries, order)?.id : undefined
    if (!customerId) {
      const existingMatch = findExistingMemberMatch(customers, {
        memberAccountNumber: values.memberAccountNumber,
        contactNumber: values.contactNumber,
        fullName: values.name,
        companyName: values.name,
      })
      if (existingMatch) customerId = existingMatch.customer.id
      else if (values.name.trim()) {
        customerId = (
          await createCustomer.mutateAsync({
            ...newMemberDefaults(),
            fullName: values.name,
            address: values.address ?? "",
            contactNumber: values.contactNumber ?? "",
            dispenserType: values.model,
            installedDate: values.installedDate || undefined,
            memberAccountNumber: values.memberAccountNumber || "",
            email: values.email ?? "",
          })
        ).id
      }
    }
    if (!order) return
    const model = values.model.trim()
    if (!sale) {
      await createSaleListEntry.mutateAsync({
        orderNumber: order,
        customerId,
        installedDate: values.installedDate || undefined,
        productNo: model,
        sc: "",
        cf: "",
        ct: "",
        cpY1Y2: "",
        status: "ACTIVE",
      })
      return
    }
    const patch: { productNo?: string; customerId?: string; installedDate?: string } = {}
    if (!sale.productNo.trim() && model) patch.productNo = model
    if (!sale.customerId && customerId) patch.customerId = customerId
    if (!sale.installedDate && values.installedDate) patch.installedDate = values.installedDate
    if (Object.keys(patch).length) await updateSaleListEntry.mutateAsync({ id: sale.id, input: patch })
  }

  async function onSubmit(values: FormValues) {
    // No longer required (see the schema's own comment) but install_plans.
    // order_no is still NOT NULL at the database level — "" satisfies that
    // fine, same as address/contactNumber below, just needs to actually be
    // a string rather than undefined before it reaches anything typed for
    // a required orderNo (the mutation input, findCustomerByOrderNumber,
    // the new Sale List entry created below).
    const orderNo = values.orderNo ?? ""
    const { collectedBy, collectedAt, email: _email, ...rest } = values
    void _email
    const input = {
      ...rest,
      orderNo,
      address: values.address ?? "",
      contactNumber: values.contactNumber ?? "",
      notifyEmail: values.email ?? "",
      memberAccountNumber: (values.memberAccountNumber ?? "").trim(),
      // No In/Out on the form: OUT unless the record already has one.
      inOut: values.inOut || "OUT",
      // No second technician without a real first, and never the same person twice.
      serviceman: normalizeTechnicianPair(values.serviceman, values.serviceman2).primary,
      serviceman2: normalizeTechnicianPair(values.serviceman, values.serviceman2).secondary,
      unitPrice: Number(values.unitPrice),
      cpPrice: Number(values.cpPrice),
      deliveryInstallationFee: Number(values.deliveryInstallationFee),
    }
    if (isEdit) {
      await updatePlan.mutateAsync({ id: plan.id, input: { ...input, ...collectedAttributionPatch(plan, { collectedBy, collectedAt }) } })
      // A plan without a job that now has a date gets its draft too — unless
      // it has an Installed Date: the database then completes it and makes
      // its completed job itself (20261101000000), and a draft on top made a
      // second job and a duplicate record.
      if (!values.installedDate) await ensureDraftJob(plan.id, plan.scheduleJobId, values)
      // An order added (or still missing its Member / Sale List entry) on edit.
      await ensureMemberAndSaleEntry(values, orderNo)
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // see the dispatch_confirmation_workflow migration. serviceman (from
      // the form's own Technician field, see below) stays "" if left
      // unassigned here — the admin can still pick one later from the
      // Pending Approvals dialog's own Technician dropdown, same as every
      // other module, this just no longer forces that field blank.
      const created = await createPlan.mutateAsync({ ...input, status: "Pending", dispatchStatus: "Draft" })
      // Already installed (Installed Date given): completed by the database
      // with its own job — no draft (see the edit branch above).
      if (!values.installedDate) await ensureDraftJob(created.id, undefined, values)

      await ensureMemberAndSaleEntry(values, orderNo)
    }
    onOpenChange(false)
  }

  const pending = createPlan.isPending || updatePlan.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
            <DialogBody className="space-y-4 py-0.5">
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
              {/* Read-only, derived from Input Date above — not a FormField
                  since there's nothing here to register/validate/submit. */}
              <div className="space-y-2">
                <Label>{tFields("yearMonthPlan")}</Label>
                <Input value={yearMonthPlan} disabled placeholder="YYYY-MM" />
              </div>
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleOrderNoBlur(e.currentTarget.value)
                          }
                        }}
                        data-testid="install-order-no"
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
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("email")}</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="name@example.com" {...field} data-testid="install-email" />
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
                    <FormControl>
                      {/* Free-text combobox, not a strict Select — a custom
                          unit/model name is always typable, with
                          MODEL_OPTIONS offered as suggestions below it. */}
                      <Combobox
                        value={field.value}
                        onChange={field.onChange}
                        options={MODEL_OPTIONS}
                        placeholder={tCommon("selectField", { field: tFields("model") })}
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
                    <FormLabel>{tFields("preD")}</FormLabel>
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
                      {/* Entering (or changing) an Installed Date means the unit
                          went out, so In or Out is set to OUT. */}
                      <Input
                        type="date"
                        {...field}
                        onChange={(e) => {
                          const next = e.target.value
                          field.onChange(e)
                          if (next && next !== field.value) form.setValue("inOut", "OUT", { shouldDirty: true })
                        }}
                        data-testid="install-installed-date"
                      />
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
              {/* Optional (this field genuinely can be left unassigned — see
                  the schema's own comment), so blank is "not assigned". Pick a
                  name from the TECHNICIANS roster (unfiltered, same list
                  Repair Plan's own Technician field and the Daily Report's
                  inline cell use) or type any other. */}
              <FormField
                control={form.control}
                name="serviceman"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("serviceman")}</FormLabel>
                    <FormControl>
                      <TechnicianCombobox value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serviceman2"
                render={({ field }) => (
                  <SecondTechnicianFormItem value={field.value} onChange={field.onChange} primary={servicemanValue} />
                )}
              />
              {isEdit && plan.collected && <CollectedAttributionFields control={form.control} />}
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
            </DialogBody>
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
