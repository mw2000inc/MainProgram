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
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Pencil, Plus, Trash2 } from "lucide-react"
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
import { PAYMENT_METHODS, PRODUCT_CATALOG, formatProductOption } from "@/lib/constants"
import { SecondTechnicianFormItem, TechnicianCombobox } from "@/components/shared/technician-combobox"
import { normalizeTechnicianPair } from "@/lib/technicians"
import { useCreateRepairPlan, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCreateRepairPlanPart } from "@/lib/hooks/use-repair-plan-parts"
import { PartFormDialog, type PartFormInput, type StagedRepairPlanPart } from "@/components/repair/repair-parts-section"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber, findExistingMemberMatch } from "@/lib/customer-lookup"
import { dateFieldSchema, moneySchema } from "@/lib/form-schemas"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { generateId } from "@/lib/utils"
import { toast } from "sonner"
import type { RepairPlan } from "@/lib/types"

// Same non-SK2 catalog suggestions install-form-dialog.tsx's own Model /
// Model(dp) comboboxes use — see that file's own comment on why DISPENSER_TYPES
// (100% "SK2 ..." variants) was dropped in favor of this.
const MODEL_OPTIONS: ComboboxOption[] = PRODUCT_CATALOG.flatMap((g) =>
  g.items.map((item) => ({ value: formatProductOption(item.code, item.name), group: g.group }))
).filter((opt) => !opt.value.toUpperCase().includes("SK2"))

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    issuedDate: dateFieldSchema(t, tf("issuedDate")),
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNo") })),
    // Previously derived silently on submit from whichever customer's
    // orderNumber happened to match (only possible because Order No. used
    // to be a required Select of existing customers, guaranteeing a match).
    // Now a real, visible field — Order No. is free text and can refer to
    // an order with no customer record at all, so there has to be somewhere
    // for the admin to type a name in that case.
    accountName: z.string().min(1, t("requiredField", { field: tf("accountName") })),
    address: z.string().optional(),
    problem: z.string().min(1, t("requiredField", { field: tf("problem") })),
    solutionStatus: z.string().optional(),
    preD: dateFieldSchema(t),
    accD: dateFieldSchema(t),
    // Trimmed before the required check so a whitespace-only entry can't slip
    // through now that this is a typable field (see TechnicianCombobox).
    th: z.string().trim().min(1, t("selectField", { field: tf("serviceman") })),
    // Optional second technician — normalized again in onSubmit.
    th2: z.string().trim().optional(),
    partNo: z.string().optional(),
    amt: moneySchema(t),
    unitInOut: z.string().min(1),
    // A directly-entered field, not pulled/joined from Sale List's own S/C
    // field — see the repair_plan_sc_field migration.
    sc: z.string().optional(),
    // AppSheet's own SalesSchedule form fields — see the RepairPlan type's
    // own comment on why these coexist with the repair-specific fields
    // above rather than replacing any of them.
    contactNumber: z.string().optional(),
    inOut: z.string().optional(),
    model: z.string().optional(),
    unitPrice: moneySchema(t),
    cpPrice: moneySchema(t),
    deliveryInstallationFee: moneySchema(t),
    paymentMode: z.string().optional(),
    receiptNo: z.string().optional(),
    preInstalledDate: dateFieldSchema(t),
    installedDate: dateFieldSchema(t),
    salesPerson: z.string().optional(),
    via: z.string().optional(),
    note: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNo?: string, plan?: RepairPlan): FormValues {
  if (plan) {
    return {
      issuedDate: plan.issuedDate,
      orderNo: plan.orderNo,
      accountName: plan.accountName,
      address: plan.address ?? "",
      problem: plan.problem,
      solutionStatus: plan.solutionStatus ?? "",
      preD: plan.preD ?? "",
      accD: plan.accD ?? "",
      th: plan.th,
      th2: plan.th2 ?? "",
      partNo: plan.partNo ?? "",
      amt: String(plan.amt ?? 0),
      unitInOut: plan.unitInOut,
      sc: plan.sc ?? "",
      contactNumber: plan.contactNumber ?? "",
      inOut: plan.inOut ?? "",
      model: plan.model ?? "",
      unitPrice: String(plan.unitPrice ?? 0),
      cpPrice: String(plan.cpPrice ?? 0),
      deliveryInstallationFee: String(plan.deliveryInstallationFee ?? 0),
      paymentMode: plan.paymentMode ?? "",
      receiptNo: plan.receiptNo ?? "",
      preInstalledDate: plan.preInstalledDate ?? "",
      installedDate: plan.installedDate ?? "",
      salesPerson: plan.salesPerson ?? "",
      via: plan.via ?? "",
      note: plan.note ?? "",
    }
  }
  return {
    issuedDate: defaultDate,
    orderNo: defaultOrderNo ?? "",
    accountName: "",
    address: "",
    problem: "",
    solutionStatus: "",
    preD: "",
    accD: "",
    th: "",
    th2: "",
    partNo: "",
    amt: "0",
    unitInOut: "In",
    sc: "",
    contactNumber: "",
    inOut: "",
    model: "",
    unitPrice: "0",
    cpPrice: "0",
    deliveryInstallationFee: "0",
    paymentMode: "",
    receiptNo: "",
    preInstalledDate: "",
    installedDate: "",
    salesPerson: "",
    via: "",
    note: "",
  }
}

export function RepairFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNo,
  plan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order No. when opened from an order's own detail page — free
  // text now (see the schema's own comment), so this always takes even when
  // there's no matching customer; the lookup effect below fills accountName
  // from it too, same as if the admin had typed it and tabbed off.
  defaultOrderNo?: string
  // Editing an existing plan instead of creating a new one.
  plan?: RepairPlan
}) {
  const isEdit = !!plan
  const createPlan = useCreateRepairPlan()
  const updatePlan = useUpdateRepairPlan()
  const createPart = useCreateRepairPlanPart()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { t } = useTranslation("repair")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNo, plan),
  })
  const thValue = form.watch("th")
  const issuedDateValue = form.watch("issuedDate")

  // Parts staged while creating a brand-new repair — this record has no
  // real id yet for repair_plan_parts.repair_plan_id to reference, so these
  // stay client-side only until onSubmit's own create-repair-then-create-
  // its-parts step below actually persists them. Add-only feature: editing
  // an existing repair's parts still happens exclusively through
  // RepairPartsSection on that record's own detail page, unchanged — see
  // the "!isEdit" guard on the Parts section further down.
  const [stagedParts, setStagedParts] = React.useState<StagedRepairPlanPart[]>([])
  const [partFormOpen, setPartFormOpen] = React.useState(false)
  const [editingStagedPart, setEditingStagedPart] = React.useState<StagedRepairPlanPart | undefined>(undefined)
  // Forces PartFormDialog to fully remount on every open — same pattern
  // repair-parts-section.tsx's own openAdd/openEdit already use (see its
  // formKey) — otherwise its internal field state (lazily initialized once,
  // not reset by a prop change) would leak from one staged part into the
  // next: e.g. Part No text typed for part #1 still sitting in the field
  // when part #2's dialog opens.
  const [partFormKey, setPartFormKey] = React.useState(0)

  function openAddPart() {
    setPartFormKey((k) => k + 1)
    setEditingStagedPart(undefined)
    setPartFormOpen(true)
  }

  function openEditPart(part: StagedRepairPlanPart) {
    setPartFormKey((k) => k + 1)
    setEditingStagedPart(part)
    setPartFormOpen(true)
  }

  function handleStagePart(input: PartFormInput & { productSku: string; productName: string }, tempId?: string) {
    if (tempId) {
      setStagedParts((old) => old.map((p) => (p.tempId === tempId ? { ...input, tempId } : p)))
    } else {
      setStagedParts((old) => [...old, { ...input, tempId: generateId("part") }])
    }
  }

  // See filter-change-form-dialog.tsx's own comment on this same pattern —
  // fills only currently-empty fields, add-only, never overwrites anything
  // already typed.
  function handleOrderNoBlur(orderNo: string) {
    if (isEdit) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, orderNo)
    if (!customer) return
    let filled = false
    const name = customer.companyName || customer.fullName
    if (name && !form.getValues("accountName").trim()) {
      form.setValue("accountName", name)
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
    if (customer.dispenserType && !(form.getValues("model") ?? "").trim()) {
      form.setValue("model", customer.dispenserType)
      filled = true
    }
    if (filled) toast.success(tCommon("customerInfoFilled"))
  }

  // The reverse direction of handleOrderNoBlur above — typing an existing
  // customer's Name or Contact # first still resolves Order No., Address,
  // and Model, instead of only working the one way around. Uses
  // findExistingMemberMatch (the same exact-match lookup the Add Member
  // form uses) searching only on whichever one field just lost focus, so a
  // half-typed value elsewhere can't cause a false match. Order No. itself
  // comes from that customer's own sale_list_entries row (the real link
  // between a customer and the "001-####" order numbers typed day to day —
  // see customer-lookup.ts's own comment on why customers.order_number
  // isn't that link) — the first one found, since a customer with more than
  // one order has no single "correct" pick here anyway. Every field is
  // filled independently and only if still empty.
  function handleCustomerLookupBlur(source: "name" | "contactNumber", value: string) {
    if (isEdit) return
    if (!value.trim()) return
    const match = findExistingMemberMatch(customers, {
      fullName: source === "name" ? value : undefined,
      companyName: source === "name" ? value : undefined,
      contactNumber: source === "contactNumber" ? value : undefined,
    })
    if (!match) return
    const customer = match.customer
    let filled = false
    const name = customer.companyName || customer.fullName
    if (name && !form.getValues("accountName").trim()) {
      form.setValue("accountName", name)
      filled = true
    }
    if (!form.getValues("orderNo").trim()) {
      const entry = saleListEntries.find((e) => e.customerId === customer.id)
      if (entry) {
        form.setValue("orderNo", entry.orderNumber)
        filled = true
      }
    }
    if (customer.address && !(form.getValues("address") ?? "").trim()) {
      form.setValue("address", customer.address)
      filled = true
    }
    if (customer.contactNumber && !(form.getValues("contactNumber") ?? "").trim()) {
      form.setValue("contactNumber", customer.contactNumber)
      filled = true
    }
    if (customer.dispenserType && !(form.getValues("model") ?? "").trim()) {
      form.setValue("model", customer.dispenserType)
      filled = true
    }
    if (filled) toast.success(tCommon("customerInfoFilled"))
  }

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNo, plan))
    // Never carries over from a previous "Add" session — staged parts are
    // scoped to the one not-yet-saved repair currently being created.
    setStagedParts([])
    // Same lookup the blur handler runs, so opening this dialog already
    // pointed at a real order (e.g. from that order's own detail page)
    // fills accountName immediately — matching how this used to resolve
    // automatically back when Order No. was a required Select of existing
    // customers, rather than needing the admin to click into and back out
    // of a field that's already correctly filled.
    if (!plan && defaultOrderNo) handleOrderNoBlur(defaultOrderNo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNo, plan])

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      // No second technician without a real first, and never the same person twice.
      th: normalizeTechnicianPair(values.th, values.th2).primary,
      th2: normalizeTechnicianPair(values.th, values.th2).secondary,
      amt: Number(values.amt),
      unitPrice: Number(values.unitPrice),
      cpPrice: Number(values.cpPrice),
      deliveryInstallationFee: Number(values.deliveryInstallationFee),
    }
    if (isEdit) {
      await updatePlan.mutateAsync({ id: plan.id, input })
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // see the dispatch_confirmation_workflow migration.
      const created = await createPlan.mutateAsync({ ...input, status: "Pending", dispatchStatus: "Draft" })
      // Two-step, not a single combined insert: this repair had no real id
      // until the create above resolved, so any parts staged while it
      // didn't exist yet can only be created now, against that real id.
      // allSettled (not all) so one part failing to save can't silently
      // stop the rest from being attempted — createPart's own onError
      // already toasts any individual failure, and the repair itself is
      // already saved regardless, so this never blocks closing the dialog.
      if (stagedParts.length > 0) {
        await Promise.allSettled(
          stagedParts.map((staged) =>
            createPart.mutateAsync({
              repairPlanId: created.id,
              input: {
                productId: staged.productId,
                customPartNo: staged.customPartNo,
                customPartName: staged.customPartName,
                inOut: staged.inOut,
                quantity: staged.quantity,
                partDate: staged.partDate,
              },
            })
          )
        )
      }
    }
    onOpenChange(false)
  }

  const pending = createPlan.isPending || updatePlan.isPending

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="issuedDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("issuedDate")}</FormLabel>
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
                  <FormLabel>{t("orderNoDot")}</FormLabel>
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
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("accountName")}</FormLabel>
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
                <FormItem>
                  <FormLabel>{tFields("address")}</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
              name="problem"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("problem")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("describeIssue")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="solutionStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("solutionStatus")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("optional")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="preD"
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
              name="accD"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("accD")}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="th"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("th")}</FormLabel>
                  <FormControl>
                    <TechnicianCombobox value={field.value ?? ""} onChange={field.onChange} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="th2"
              render={({ field }) => <SecondTechnicianFormItem value={field.value} onChange={field.onChange} primary={thValue} />}
            />
            <FormField
              control={form.control}
              name="partNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("partNo")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("optional")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("amt")}</FormLabel>
                  <FormControl>
                    {/* Explicit fallback on top of the {...field} spread —
                        belt-and-suspenders against field.value ever being
                        undefined (e.g. an existing row read back before its
                        new column's migration has run), since
                        CurrencyInput's own formatForDisplay() calls
                        value.trim() with no guard of its own. */}
                    <CurrencyInput {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="unitInOut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("unitInOut")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="In">In</SelectItem>
                      <SelectItem value="Out">Out</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {/* Add-only: staging parts here only makes sense before this
                repair exists at all. Editing an existing one keeps managing
                its parts exclusively through RepairPartsSection on that
                record's own detail page (grouped-by-date history, Expand
                view, etc.) — richer than this needs to be for a repair
                that's still being created for the first time. */}
            {!isEdit && (
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {tFields("partNo")} <Badge variant="secondary">{stagedParts.length}</Badge>
                  </span>
                  <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2" onClick={openAddPart}>
                    <Plus className="h-3.5 w-3.5" /> {t("addPart")}
                  </Button>
                </div>
                {stagedParts.length > 0 && (
                  <div className="space-y-1">
                    {stagedParts.map((p) => (
                      <div key={p.tempId} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm">
                        <span className="min-w-0 truncate">
                          {p.productSku} — {p.productName} · {p.inOut} · {tFields("quantity")}: {p.quantity}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditPart(p)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-danger hover:text-danger"
                            onClick={() => setStagedParts((old) => old.filter((x) => x.tempId !== p.tempId))}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Below here: the same SalesSchedule-form fields
                install-form-dialog.tsx has — see the RepairPlan type's own
                comment on why these coexist with (rather than replace) the
                repair-specific fields above. */}
            <FormField
              control={form.control}
              name="inOut"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("inOrOut")}</FormLabel>
                  {/* Segmented IN/OUT toggle, matching
                      install-form-dialog.tsx's own — distinct from
                      Unit IN/OUT above (different field, different casing). */}
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
              name="sc"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("sc")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("optional")} {...field} />
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
                      value={field.value ?? ""}
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
                    {/* Explicit fallback on top of the {...field} spread —
                        belt-and-suspenders against field.value ever being
                        undefined (e.g. an existing row read back before its
                        new column's migration has run), since
                        CurrencyInput's own formatForDisplay() calls
                        value.trim() with no guard of its own. */}
                    <CurrencyInput {...field} value={field.value ?? ""} />
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
                    {/* Explicit fallback on top of the {...field} spread —
                        belt-and-suspenders against field.value ever being
                        undefined (e.g. an existing row read back before its
                        new column's migration has run), since
                        CurrencyInput's own formatForDisplay() calls
                        value.trim() with no guard of its own. */}
                    <CurrencyInput {...field} value={field.value ?? ""} />
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
                    {/* Explicit fallback on top of the {...field} spread —
                        belt-and-suspenders against field.value ever being
                        undefined (e.g. an existing row read back before its
                        new column's migration has run), since
                        CurrencyInput's own formatForDisplay() calls
                        value.trim() with no guard of its own. */}
                    <CurrencyInput {...field} value={field.value ?? ""} />
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
                <FormItem>
                  <FormLabel>{tFields("note")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder={tCommon("optionalNotes")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : tCommon("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    {/* Staging mode (onStage, no repairPlanId) — see stagedParts/
        handleStagePart above. Kept mounted only while !isEdit's own Parts
        section is even shown, same as every other nested dialog here. */}
    {!isEdit && (
      <PartFormDialog
        key={partFormKey}
        open={partFormOpen}
        onOpenChange={setPartFormOpen}
        stagedPart={editingStagedPart}
        onStage={handleStagePart}
        defaultDate={issuedDateValue || defaultDate}
      />
    )}
    </>
  )
}
