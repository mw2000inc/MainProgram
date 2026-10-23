"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { CheckCircle2, ExternalLink, Sparkles } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  useCreateFilterChangePlan,
  useUpdateFilterChangePlan,
  useSuggestTechnician,
} from "@/lib/hooks/use-filter-change-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import { useProducts } from "@/lib/hooks/use-inventory"
import { findCustomerByOrderNumber, findExistingMemberMatch } from "@/lib/customer-lookup"
import { cpSystemDueFilterCodes, getCpSystemFilterSkus } from "@/lib/filter-parts"
import { Combobox } from "@/components/ui/combobox"
import { dateFieldSchema } from "@/lib/form-schemas"
import { normalizeTechnicianPair } from "@/lib/technicians"
import { SecondTechnicianFormItem, TechnicianCombobox } from "@/components/shared/technician-combobox"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { extractCityLabel } from "@/lib/geo/city-label"
import { toast } from "sonner"
import type { FilterChangePlan } from "@/lib/types"
import { logAppMessage } from "@/components/shared/app-message-logger"
import { statusForAccD } from "@/components/filter-change/filter-change-columns"
import { useVisitDraftJob } from "@/lib/scheduling/use-visit-draft-job"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { VEHICLE_TYPES } from "@/lib/constants"

const VEHICLE_OPTIONS = VEHICLE_TYPES.map((v) => ({ value: v }))
import { businessToday } from "@/lib/dispatch-lead-time"
import { format, parseISO, subMonths } from "date-fns"

// A factory, not a module-scope constant — validation messages need t(),
// which only exists once useTranslation() has run inside the component (see
// the login page's own schema factories for the original precedent).
// A Plan D / Pre D more than this many months before today is refused — a
// mistyped year ("2025" for "2026") instead of a real visit. A date the record
// already had is kept (editing an old record never trips it).
const MAX_MONTHS_IN_PAST = 6

function createSchema(
  t: (key: string, params?: Record<string, string>) => string,
  tf: (key: string) => string,
  tooOld: (date: string) => string,
  original?: { planDate?: string; preD?: string }
) {
  const earliest = format(subMonths(parseISO(businessToday()), MAX_MONTHS_IN_PAST), "yyyy-MM-dd")
  return z.object({
    orderNumber: z.string().min(1, t("requiredField", { field: tf("orderNumber") })),
    memberAccount: z.string().min(1, t("requiredField", { field: tf("memberAccount") })),
    filterType: z.string(),
    planDate: dateFieldSchema(t, tf("planD")),
    contactNumber: z.string().optional(),
    address: z.string().optional(),
    sc: z.string().optional(),
    productNo: z.string().optional(),
    preD: dateFieldSchema(t),
    accD: dateFieldSchema(t),
    // Both trimmed — typable fields (see TechnicianCombobox); the pair is
    // normalized again in onSubmit.
    serviceman: z.string().trim().optional(),
    serviceman2: z.string().trim().optional(),
    // The visit's vehicle — kept on its schedule job, not the record.
    vehicle: z.string().trim().optional(),
    note: z.string().optional(),
  }).superRefine((v, ctx) => {
    for (const key of ["planDate", "preD"] as const) {
      const value = (v[key] ?? "").trim()
      if (value && value !== (original?.[key] ?? "") && value < earliest) ctx.addIssue({ code: "custom", path: [key], message: tooOld(earliest) })
    }
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNumber?: string, plan?: FilterChangePlan): FormValues {
  if (plan) {
    return {
      orderNumber: plan.orderNumber,
      memberAccount: plan.memberAccount,
      filterType: plan.filterType,
      planDate: plan.planDate,
      contactNumber: plan.contactNumber,
      address: plan.address,
      sc: plan.sc,
      productNo: plan.productNo,
      preD: plan.preD ?? "",
      accD: plan.accD ?? "",
      serviceman: plan.serviceman,
      serviceman2: plan.serviceman2 ?? "",
      vehicle: "",
      note: plan.note ?? "",
    }
  }
  return {
    orderNumber: defaultOrderNumber ?? "",
    memberAccount: "",
    filterType: "",
    planDate: defaultDate,
    contactNumber: "",
    address: "",
    sc: "",
    productNo: "",
    preD: "",
    accD: "",
    serviceman: "",
    serviceman2: "",
    vehicle: "",
    note: "",
  }
}

export function FilterChangeFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNumber,
  plan,
  onSaved,
  autoApprove,
  prefillPreD,
}: {
  // Opened from the Daily Report by an admin: the visit's job is approved at
  // once instead of waiting in Pending Schedule Approval (useVisitDraftJob).
  autoApprove?: boolean
  // Opened from the Daily Report's Add: a new record's Pre D (Pre-Installed
  // Date for installs) starts on the report's date (defaultDate).
  prefillPreD?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order Number when opened from an order's own detail page, so the
  // new record is tied to that order without the admin retyping it.
  defaultOrderNumber?: string
  // Editing an existing plan instead of creating a new one.
  plan?: FilterChangePlan
  // Fired with the saved record right after a successful create OR update,
  // before the dialog closes — lets the list page (which scopes its own
  // table to one month tab) jump to whichever month this record actually
  // landed in, so it's visible immediately instead of silently filtered out
  // of the tab the admin happened to be on when they saved a plan dated
  // outside it.
  onSaved?: (plan: FilterChangePlan) => void
}) {
  const isEdit = !!plan
  const createPlan = useCreateFilterChangePlan()
  const ensureVisitDraftJob = useVisitDraftJob()
  const updatePlan = useUpdateFilterChangePlan()
  const suggestTechnician = useSuggestTechnician()
  const suggestion = suggestTechnician.data ?? null
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: cpSystems = [] } = useCpSystems()
  const { data: products = [] } = useProducts()
  const { t } = useTranslation("filterChange")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(
    () =>
      createSchema(tCommon, tFields, (earliest) => t("dateTooFarInPast", { months: "6", date: earliest }), plan ? { planDate: plan.planDate, preD: plan.preD } : undefined),
    [tCommon, tFields, t, plan]
  )
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNumber, plan),
  })
  const servicemanValue = form.watch("serviceman")
  // Duplicate guard: another PENDING Filter Change for the same Order No. on
  // the same visit date (Pre D, else Plan D). The first save shows a warning
  // and turns the button into "Save anyway"; changing the order or date
  // clears it.
  const { data: allPlans = [] } = useFilterChangePlans()
  // The vehicle on the visit's schedule job (editing) — prefilled once the
  // form opens, and compared on save so an unchanged one isn't re-saved.
  const { data: scheduleJobs = [] } = useScheduleJobs()
  const planJobVehicle = (plan?.scheduleJobId ? scheduleJobs.find((j) => j.id === plan.scheduleJobId)?.vehicle : "")?.trim() ?? ""
  const [vehicleFilledFor, setVehicleFilledFor] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) {
      setVehicleFilledFor(null)
      return
    }
    const key = plan?.id ?? "new"
    if (vehicleFilledFor === key || (plan?.scheduleJobId && !scheduleJobs.length)) return
    setVehicleFilledFor(key)
    if (planJobVehicle && !(form.getValues("vehicle") ?? "").trim()) form.setValue("vehicle", planJobVehicle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan?.id, planJobVehicle, scheduleJobs.length])
  // plans: the pending visits it matched — each a link in the warning that
  // opens it on the Filter Change page in a new tab (this form stays as typed).
  const [duplicateWarning, setDuplicateWarning] = React.useState<{ key: string; count: number; order: string; date: string; plans: FilterChangePlan[] } | null>(null)
  const watchedOrder = form.watch("orderNumber")
  const watchedPlanDate = form.watch("planDate")
  const watchedPreD = form.watch("preD")
  React.useEffect(() => {
    const key = `${(watchedOrder ?? "").trim()}|${watchedPreD || watchedPlanDate}`
    if (duplicateWarning && duplicateWarning.key !== key) setDuplicateWarning(null)
  }, [watchedOrder, watchedPlanDate, watchedPreD, duplicateWarning])
  React.useEffect(() => {
    if (open) setDuplicateWarning(null)
  }, [open])
  // Order Number search: every Sale List order with its customer — type an
  // order or a customer name. Picking one (or typing an exact order) fills the
  // empty fields (fillFromOrder).
  const orderOptions = React.useMemo(() => {
    const byId = new Map(customers.map((c) => [c.id, c]))
    return saleListEntries
      .filter((e) => e.orderNumber.trim())
      .map((e) => {
        const c = e.customerId ? byId.get(e.customerId) : undefined
        const name = c ? c.companyName || c.fullName : ""
        return { value: name ? `${e.orderNumber.trim()} — ${name}` : e.orderNumber.trim() }
      })
  }, [saleListEntries, customers])
  const orderNumberValue = form.watch("orderNumber")
  const [autoFilledFor, setAutoFilledFor] = React.useState("")
  // A typed order that exactly matches one fills in after a short pause.
  React.useEffect(() => {
    if (isEdit || !open) return
    const order = (orderNumberValue ?? "").trim()
    if (!order || order === autoFilledFor) return
    if (!saleListEntries.some((e) => e.orderNumber.trim() === order)) return
    const timer = setTimeout(() => handleOrderNumberBlur(order), 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumberValue, isEdit, open, saleListEntries])
  React.useEffect(() => {
    if (open) setAutoFilledFor("")
  }, [open])

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNumber, plan))
    if (!plan && prefillPreD && defaultDate) form.setValue("preD", defaultDate)
    suggestTechnician.reset()
    // Same lookup the blur handler runs below — opening this dialog already
    // pointed at a real order (e.g. from that order's own detail page)
    // fills the rest in immediately, without needing the admin to click
    // into and back out of a field that's already correctly filled.
    if (!plan && defaultOrderNumber) handleOrderNumberBlur(defaultOrderNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNumber, plan])

  // Fills serviceman with the nearest-technician pick (see
  // filter-change-suggest.ts) — never submitted automatically, the admin
  // still reviews/overrides it and clicks Save like any other edit.
  async function handleSuggest() {
    if (!plan) return
    const result = await suggestTechnician.mutateAsync(plan.id).catch(() => null)
    if (!result) return
    form.setValue("serviceman", result.technician, { shouldDirty: true })
  }

  // Looks up the typed order number against the customers table (one row
  // per order — see customer-lookup.ts) the moment the admin tabs off the
  // field, and fills in whatever it finds — but only into fields still
  // empty, so it can never overwrite something already typed here, whether
  // that happened before or after this fires. Add-only: while editing an
  // existing plan every field already has real data, so this would have
  // nothing to safely fill anyway.
  function handleOrderNumberBlur(orderNumber: string) {
    if (isEdit) return
    const order = orderNumber.trim()
    if (!order || order === autoFilledFor) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, order)
    const saleForOrder = saleListEntries.find((e) => e.orderNumber.trim() === order)
    let anyFilled = false
    // S/C and Product # straight from the order's Sale List entry.
    if (saleForOrder?.sc?.trim() && !(form.getValues("sc") ?? "").trim()) {
      form.setValue("sc", saleForOrder.sc.trim(), { shouldDirty: true })
      anyFilled = true
    }
    if (saleForOrder?.productNo?.trim() && !(form.getValues("productNo") ?? "").trim()) {
      form.setValue("productNo", saleForOrder.productNo.trim(), { shouldDirty: true })
      anyFilled = true
    }
    if (customer) {
      let filled = false
      const name = customer.companyName || customer.fullName
      if (name && !form.getValues("memberAccount").trim()) {
        form.setValue("memberAccount", name)
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
      anyFilled ||= filled
    }

    // CP System is linked per ORDER (sale_list_entries.cp_system_id), not per
    // customer — one customer can have several orders on different systems —
    // so this is matched directly against the typed order number rather than
    // going through the customer resolved above. Same add-only rule as
    // everything else here: only fires into a still-blank Filter field, and
    // only when the linked system actually has at least one component that
    // resolves to a real product SKU (see getCpSystemFilterSkus) — an
    // unlinked order, or one on a system with no catalog match yet, leaves
    // Filter exactly as untouched as it always was.
    // The filters due on this visit's date (Pre D, else Plan D) in the order's
    // CP cycle come first; when the date isn't set or nothing is due that
    // month, every filter of the system (as before).
    if (!form.getValues("filterType").trim()) {
      const system = saleForOrder?.cpSystemId ? cpSystems.find((s) => s.id === saleForOrder.cpSystemId) : undefined
      const visitDate = form.getValues("preD") || form.getValues("planDate")
      const due = system ? cpSystemDueFilterCodes(system, saleForOrder?.cpStart, visitDate) : []
      const skus = due.length > 0 ? due : system ? getCpSystemFilterSkus(system, products) : []
      if (system && skus.length > 0) {
        form.setValue("filterType", skus.join(", "))
        toast.success(t("filterSuggestedFromCpSystem", { systemCode: system.systemCode }))
        anyFilled = true
      }
    }
    if (anyFilled || customer || saleForOrder) setAutoFilledFor(order)
  }

  // Same add-only autofill as handleOrderNumberBlur above, keyed off Member
  // Account# instead — that field doubles as a free-text name/account entry
  // here (see its own placeholder), so typing an existing customer's name
  // directly (without an Order Number) still resolves their contact/address
  // via the same exact-match lookup the Add Member form uses.
  function handleMemberAccountBlur(value: string) {
    if (isEdit) return
    if (!value.trim()) return
    const match = findExistingMemberMatch(customers, { fullName: value, companyName: value })
    if (!match) return
    const customer = match.customer
    let filled = false
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
    const order = values.orderNumber.trim()
    const visitDate = values.preD || values.planDate
    const key = `${order}|${visitDate}`
    const duplicates = allPlans.filter(
      (p) => p.id !== plan?.id && p.status === "Pending" && p.orderNumber.trim() === order && (p.preD || p.planDate) === visitDate
    )
    if (duplicates.length > 0 && duplicateWarning?.key !== key) {
      setDuplicateWarning({ key, count: duplicates.length, order, date: visitDate, plans: duplicates })
      // Kept in the bell too, after this form is closed.
      logAppMessage(
        "warning",
        t("duplicatePendingWarning", { count: String(duplicates.length), order, date: visitDate }),
        undefined,
        `/filter-change?id=${encodeURIComponent(duplicates[0].id)}`
      )
      return
    }
    // The vehicle belongs to the visit's schedule job, not the record.
    const { vehicle: vehicleValue, ...recordValues } = values
    const vehicle = (vehicleValue ?? "").trim()
    const input = {
      ...recordValues,
      contactNumber: values.contactNumber ?? "",
      address: values.address ?? "",
      sc: values.sc ?? "",
      productNo: values.productNo ?? "",
      // No second technician without a real first, and never the same person twice.
      serviceman: normalizeTechnicianPair(values.serviceman, values.serviceman2).primary,
      serviceman2: normalizeTechnicianPair(values.serviceman, values.serviceman2).secondary,
      // Acc D set -> Completed, cleared -> Pending (statusForAccD) — only
      // when this save actually changes Acc D, so saving e.g. a Cancelled
      // visit without touching Acc D leaves its status alone.
      ...(isEdit && (values.accD ?? "") !== (plan.accD ?? "") ? { status: statusForAccD(values.accD) } : {}),
    }
    const saved = isEdit
      ? await updatePlan.mutateAsync({ id: plan.id, input })
      : // A new manually-scheduled dispatch enters the admin approval queue —
        // unlike auto-generated recurring-schedule/C/T-completion rows, which
        // stay at the 'Confirmed' default set at the database layer (see the
        // dispatch_confirmation_workflow migration).
        await createPlan.mutateAsync({ ...input, status: statusForAccD(values.accD), dispatchStatus: "Draft" })
    // Approval first: a new, still-pending Filter Change gets its draft job
    // straight away — on its Pre D, else its Plan D (today included) — with
    // the order, member, address, technician(s) and filters, waiting in
    // Schedule › Pending Schedule Approval under that date (useVisitDraftJob).
    // Edited from the Daily Report (autoApprove): its waiting draft is approved.
    if ((!isEdit || (autoApprove && saved.scheduleJobId)) && saved.status === "Pending") {
      await ensureVisitDraftJob({
        approve: autoApprove,
        table: "filter_change_plans",
        jobType: "filter_change",
        recordId: saved.id,
        existingJobId: saved.scheduleJobId,
        date: values.preD || values.planDate,
        orderNo: values.orderNumber,
        address: input.address,
        technician: input.serviceman,
        technician2: input.serviceman2,
        notes: [values.memberAccount, values.filterType].filter(Boolean).join(" — "),
        filterCodes: values.filterType,
        vehicle,
      })
    } else if (isEdit && saved.scheduleJobId && vehicle && vehicle !== planJobVehicle) {
      // Edited elsewhere: a changed vehicle goes onto the visit's job.
      await ensureVisitDraftJob({ table: "filter_change_plans", jobType: "filter_change", recordId: saved.id, existingJobId: saved.scheduleJobId, vehicle })
    }
    onSaved?.(saved)
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
              <FormField
                control={form.control}
                name="orderNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("orderNumber")}</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value}
                        // A picked "001-0001 — Name" keeps just the order.
                        onChange={(v) => field.onChange(v.split(" — ")[0])}
                        onOptionSelect={(v) => {
                          const order = v.split(" — ")[0].trim()
                          field.onChange(order)
                          handleOrderNumberBlur(order)
                        }}
                        options={isEdit ? [] : orderOptions}
                        maxResults={20}
                        placeholder={t("orderSearchPlaceholder")}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                          field.onBlur()
                          handleOrderNumberBlur(e.target.value.split(" — ")[0])
                        }}
                        data-testid="fc-order-number"
                      />
                    </FormControl>
                    {!isEdit && autoFilledFor && autoFilledFor === (field.value ?? "").trim() && (
                      <p className="flex items-center gap-1 text-xs text-success" data-testid="fc-order-autofilled">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("orderAutoFilled")}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="memberAccount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("memberAccount")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("accountOrCompanyName")}
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleMemberAccountBlur(e.target.value)
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="filterType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("filter")}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 012, 013" {...field} />
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
                name="address"
                render={({ field }) => {
                  const cityLabel = extractCityLabel(field.value)
                  return (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>{tFields("address")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("serviceAddress")} {...field} />
                      </FormControl>
                      {cityLabel && <p className="text-xs text-muted-foreground">{t("recognizedArea", { area: cityLabel })}</p>}
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
              <FormField
                control={form.control}
                name="sc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("sc")}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. UF44 / UF4" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="productNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("productNo")}</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 103 / MW) Hercules" {...field} />
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
                name="serviceman"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("serviceman")}</FormLabel>
                    <div className="flex gap-1.5">
                      <FormControl>
                        <TechnicianCombobox value={field.value ?? ""} onChange={field.onChange} className="flex-1" />
                      </FormControl>
                      {isEdit && plan?.customerId && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          title={t("suggestTechnician")}
                          disabled={suggestTechnician.isPending}
                          onClick={handleSuggest}
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    {suggestion && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">{suggestion.explanation}</p>
                        {suggestion.outsideCoverage && (
                          <Badge variant="outline" className="text-amber-600 border-amber-600/40">
                            {t("outsideUsualCoverage")}
                          </Badge>
                        )}
                      </div>
                    )}
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
              <FormField
                control={form.control}
                name="vehicle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehicle</FormLabel>
                    <FormControl>
                      {/* Pick one or type any vehicle — saved on the visit's
                          schedule job, so its technician(s) see it on their
                          Daily Report and Release Slip (useVisitDraftJob). */}
                      <Combobox value={field.value ?? ""} onChange={field.onChange} options={VEHICLE_OPTIONS} placeholder="Select or type a vehicle" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="planDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("date")}</FormLabel>
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
            </div>
            </DialogBody>
            {duplicateWarning && (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" data-testid="fc-duplicate-warning">
                {t("duplicatePendingWarning", { count: String(duplicateWarning.count), order: duplicateWarning.order, date: duplicateWarning.date })}
                <ul className="mt-1.5 space-y-1">
                  {duplicateWarning.plans.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`/filter-change?id=${encodeURIComponent(d.id)}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                        data-testid="fc-duplicate-link"
                      >
                        {[d.orderNumber.trim(), d.memberAccount.trim(), d.filterType.trim(), d.serviceman.trim()].filter(Boolean).join(" · ")}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending} variant={duplicateWarning ? "destructive" : "default"} data-testid="fc-submit">
                {pending ? tCommon("saving") : duplicateWarning ? t("saveAnyway") : isEdit ? tCommon("saveChanges") : tCommon("add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
