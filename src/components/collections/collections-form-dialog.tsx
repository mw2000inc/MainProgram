"use client"

import * as React from "react"
import { CheckCircle2 } from "lucide-react"
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
import { CurrencyInput } from "@/components/shared/currency-input"
import {
  CollectedAttributionFields,
  collectedAttributionDefaults,
  collectedAttributionPatch,
} from "@/components/shared/collected-attribution-fields"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { useCreateCollection, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { normalizeTechnicianPair } from "@/lib/technicians"
import { SecondTechnicianFormItem, TechnicianCombobox } from "@/components/shared/technician-combobox"
import { useVisitDraftJob } from "@/lib/scheduling/use-visit-draft-job"
import { COLLECTION_PAYMENT_TYPES } from "@/lib/constants"
import { dateFieldSchema, moneySchema } from "@/lib/form-schemas"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"
import type { CollectionPlan } from "@/lib/types"

// Preset suggestions offered below the field — still a real text input (see
// the Combobox below), so a custom/unlisted payment type is always typable
// and never rejected. Same "pick from suggestions or type your own" pattern
// as Install's Model/Model(dp) fields, not the locked Select Install's own
// (differently-worded) Payment Mode field uses.
const PAYMENT_TYPE_OPTIONS: ComboboxOption[] = COLLECTION_PAYMENT_TYPES.map((v) => ({ value: v }))

// "₱3,000" / "9600" → 3000 / 9600 — the same reading as the database's
// parse_currency_amount (a Sale List C/F is free text); 0 when unreadable.
function parseCurrencyAmount(text: string | undefined): number {
  const n = Number((text ?? "").replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

// This form had no way to actually mark a collection Collected before —
// status could only ever be read, never changed, from this dialog. Matches
// the Pending/Completed/Cancelled convention already used by every other
// plan table's status (see PlanStatusBadge) — "Collected" instead of
// "Completed" since that's this domain's own natural word for it (and
// PlanStatusBadge already recognizes it as the same success tone).
const STATUS_OPTIONS = ["Pending", "Collected", "Cancelled"] as const

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNumber") })),
    accountName: z.string().min(1, t("requiredField", { field: tf("memberAccount") })),
    amount: moneySchema(t, tf("amount")),
    ct: z.string().optional(),
    collectionDate: dateFieldSchema(t, tf("planD")),
    status: z.string().min(1),
    preD: dateFieldSchema(t),
    accD: dateFieldSchema(t),
    note: z.string().optional(),
    paymentType: z.string().optional(),
    // Typable (see TechnicianCombobox); the pair is normalized on submit.
    serviceman: z.string().trim().optional(),
    serviceman2: z.string().trim().optional(),
    collectedBy: z.string().optional(),
    collectedAt: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNo?: string, entry?: CollectionPlan): FormValues {
  if (entry) {
    return {
      orderNo: entry.orderNo,
      accountName: entry.accountName,
      amount: String(entry.amount),
      ct: entry.ct,
      collectionDate: entry.collectionDate,
      status: entry.status || "Pending",
      preD: entry.preD ?? "",
      accD: entry.accD ?? "",
      note: entry.note ?? "",
      paymentType: entry.paymentType ?? "",
      serviceman: entry.serviceman ?? "",
      serviceman2: entry.serviceman2 ?? "",
      ...collectedAttributionDefaults(entry),
    }
  }
  return {
    orderNo: defaultOrderNo ?? "",
    accountName: "",
    amount: "0",
    ct: "",
    collectionDate: defaultDate,
    status: "Pending",
    preD: "",
    accD: "",
    note: "",
    paymentType: "",
    serviceman: "",
    serviceman2: "",
    ...collectedAttributionDefaults(),
  }
}

export function CollectionsFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNo,
  entry,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order Number when opened from an order's own detail page.
  defaultOrderNo?: string
  // Editing an existing collection instead of creating a new one.
  entry?: CollectionPlan
  // Fired with the saved record right after a successful create OR update,
  // before the dialog closes — see filter-change-form-dialog.tsx's own
  // identical prop for why: this page's own table is scoped to one month
  // tab, so a saved record dated outside it would otherwise be invisible
  // until the admin happened to switch tabs themselves.
  onSaved?: (entry: CollectionPlan) => void
}) {
  const isEdit = !!entry
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const ensureVisitDraftJob = useVisitDraftJob()
  const { t } = useTranslation("collection")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNo, entry),
  })

  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const [autoFilledFor, setAutoFilledFor] = React.useState("")
  // The pair last copied from a Filter Change visit — replaced when the order
  // or Plan D changes, unless the admin has since picked someone else.
  const inheritedRef = React.useRef<{ primary: string; secondary: string } | null>(null)
  const [inheritedFrom, setInheritedFrom] = React.useState("")
  // Same for Pre D: the date last copied from a Filter Change visit.
  const inheritedPreDRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNo, entry))
    setAutoFilledFor("")
    inheritedRef.current = null
    setInheritedFrom("")
    inheritedPreDRef.current = null
    // Same lookup the blur handler runs below — opening this dialog already
    // pointed at a real order fills it in immediately, without needing the
    // admin to click into and back out of the field.
    if (!entry && defaultOrderNo) handleOrderNoBlur(defaultOrderNo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNo, entry])

  // Order Number search: every Sale List order with its customer — type an
  // order or a customer name (the same list as the Filter Change form).
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

  // A typed order that exactly matches one fills in after a short pause.
  const orderNoValue = form.watch("orderNo")
  React.useEffect(() => {
    if (isEdit || !open) return
    const order = (orderNoValue ?? "").trim()
    if (!order || order === autoFilledFor) return
    if (!saleListEntries.some((e) => e.orderNumber.trim() === order)) return
    const timer = setTimeout(() => handleOrderNoBlur(order), 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNoValue, isEdit, open, saleListEntries])

  // Fills the order's details into fields still empty, add-only — never
  // overwrites something already typed (filter-change-form-dialog.tsx's same
  // pattern): the Member Account from its customer, and the Amount (its full
  // C/F, the collection amount rule) and C/T from its Sale List entry.
  function handleOrderNoBlur(orderNo: string) {
    if (isEdit) return
    const order = orderNo.trim()
    if (!order || order === autoFilledFor) return
    let anyFilled = false
    const customer = findCustomerByOrderNumber(customers, saleListEntries, order)
    const name = customer ? customer.companyName || customer.fullName : ""
    if (name && !form.getValues("accountName").trim()) {
      form.setValue("accountName", name, { shouldDirty: true, shouldValidate: true })
      anyFilled = true
    }
    const sale = saleListEntries.find((e) => e.orderNumber.trim() === order)
    const cf = parseCurrencyAmount(sale?.cf)
    if (cf > 0 && !(Number(form.getValues("amount")) > 0)) {
      form.setValue("amount", String(cf), { shouldDirty: true, shouldValidate: true })
      anyFilled = true
    }
    if (sale?.ct?.trim() && !(form.getValues("ct") ?? "").trim()) {
      form.setValue("ct", sale.ct.trim(), { shouldDirty: true })
      anyFilled = true
    }
    if (anyFilled) {
      setAutoFilledFor(order)
      toast.success(tCommon("customerInfoFilled"))
    }
  }

  // Serviceman: the technicians of the open Filter Change visit on this order
  // and Plan D (same trip — the Collection goes with it), up to two. Filled
  // while the Serviceman is empty or still holds a pair copied here; a pair
  // the admin picked themselves is left alone.
  const collectionDateValue = form.watch("collectionDate")
  React.useEffect(() => {
    if (isEdit || !open) return
    const order = (orderNoValue ?? "").trim()
    const visit =
      order && collectionDateValue
        ? filterChangePlans.find(
            (p) => p.orderNumber.trim() === order && p.planDate === collectionDateValue && p.status === "Pending" && !p.accD && (p.serviceman ?? "").trim()
          )
        : undefined
    const current = normalizeTechnicianPair(form.getValues("serviceman") ?? "", form.getValues("serviceman2") ?? "")
    const last = inheritedRef.current
    const untouched = !current.primary || (!!last && last.primary === current.primary && last.secondary === current.secondary)
    if (!untouched) return
    if (visit) {
      const pair = normalizeTechnicianPair(visit.serviceman, visit.serviceman2 ?? "")
      form.setValue("serviceman", pair.primary, { shouldDirty: true })
      form.setValue("serviceman2", pair.secondary, { shouldDirty: true })
      inheritedRef.current = pair
      setInheritedFrom(`${order}|${collectionDateValue}`)
    } else if (last) {
      form.setValue("serviceman", "", { shouldDirty: true })
      form.setValue("serviceman2", "", { shouldDirty: true })
      inheritedRef.current = null
      setInheritedFrom("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNoValue, collectionDateValue, filterChangePlans, isEdit, open])
  // Pre D: the same open Filter Change visit's Pre D (its moved-to visit
  // date), so the Collection goes on that trip too. Filled while Pre D is
  // empty or still holds a date copied here — a date the admin typed is kept;
  // changing the order or Plan D follows the new visit (or clears a copied
  // date when there's none).
  React.useEffect(() => {
    if (isEdit || !open) return
    const order = (orderNoValue ?? "").trim()
    const visit =
      order && collectionDateValue
        ? filterChangePlans.find((p) => p.orderNumber.trim() === order && p.planDate === collectionDateValue && p.status === "Pending" && !p.accD)
        : undefined
    const current = form.getValues("preD") ?? ""
    const last = inheritedPreDRef.current
    if (current && current !== last) return
    const next = visit?.preD ?? ""
    if (next === current) {
      inheritedPreDRef.current = next || null
      return
    }
    if (next || last) {
      form.setValue("preD", next, { shouldDirty: true, shouldValidate: true })
      inheritedPreDRef.current = next || null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNoValue, collectionDateValue, filterChangePlans, isEdit, open])
  const preDValue = form.watch("preD")
  const showPreDHint = !isEdit && !!preDValue && preDValue === inheritedPreDRef.current

  const servicemanValue = form.watch("serviceman")
  const serviceman2Value = form.watch("serviceman2")
  const currentPair = normalizeTechnicianPair(servicemanValue ?? "", serviceman2Value ?? "")
  const showInheritedHint =
    !!inheritedFrom &&
    !!inheritedRef.current &&
    inheritedRef.current.primary === currentPair.primary &&
    inheritedRef.current.secondary === currentPair.secondary

  async function onSubmit(values: FormValues) {
    const { collectedBy, collectedAt, serviceman, serviceman2, ...rest } = values
    // Exactly the technicians picked (one or two) — never re-paired.
    const pair = normalizeTechnicianPair(serviceman ?? "", serviceman2 ?? "")
    const input = { ...rest, amount: Number(values.amount), ct: values.ct ?? "", serviceman: pair.primary, serviceman2: pair.secondary }
    const saved = isEdit
      ? await updateCollection.mutateAsync({ id: entry.id, input: { ...input, ...collectedAttributionPatch(entry, { collectedBy, collectedAt }) } })
      : // A new manually-scheduled dispatch enters the admin approval queue —
        // see the dispatch_confirmation_workflow migration. The Serviceman is
        // what the form holds (the same-day Filter Change's technicians by
        // default); left blank, useCreateCollection still looks that visit up,
        // else it stays unassigned for the admin to pick before approving.
        await createCollection.mutateAsync({ ...input, dispatchStatus: "Draft" })
    // Approval first: a new, still-pending collection gets its draft job on
    // its Pre D, else its Plan D — with the order, account, the member's
    // address, the order's product and the amount — and waits in Schedule ›
    // Pending Schedule Approval under that date. The admin picks the
    // technician there; approving puts it on that day's Collection Plan and
    // the technician's agenda (useVisitDraftJob).
    if (!isEdit && saved.status === "Pending" && !saved.collected) {
      await ensureVisitDraftJob({
        table: "collections",
        jobType: "collection",
        recordId: saved.id,
        existingJobId: saved.scheduleJobId,
        date: values.preD || values.collectionDate,
        orderNo: values.orderNo,
        accountName: values.accountName,
        amount: Number(values.amount) || undefined,
        notes: null,
        // The record's technicians → its draft job, exactly (no auto-pick).
        technician: saved.serviceman || undefined,
        technician2: saved.serviceman2 || undefined,
      })
    }
    onSaved?.(saved)
    onOpenChange(false)
  }

  const pending = createCollection.isPending || updateCollection.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? (entry.source === "recurring_schedule" ? t("editScheduleTitle") : t("editTitle")) : t("addTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? entry.source === "recurring_schedule"
                ? t("recurringScheduleDescription")
                : t("editDescription")
              : t("addDescription")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col gap-4">
            <DialogBody className="space-y-4 py-0.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="orderNo"
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
                          handleOrderNoBlur(order)
                        }}
                        options={isEdit ? [] : orderOptions}
                        maxResults={20}
                        placeholder={t("orderSearchPlaceholder")}
                        onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                          field.onBlur()
                          handleOrderNoBlur(e.target.value.split(" — ")[0])
                        }}
                        data-testid="collection-order-number"
                      />
                    </FormControl>
                    {!isEdit && autoFilledFor && autoFilledFor === (field.value ?? "").trim() && (
                      <p className="flex items-center gap-1 text-xs text-success" data-testid="collection-order-autofilled">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("orderAutoFilled")}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accountName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("memberAccount")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("customerOrBusinessName")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("amount")}</FormLabel>
                    <FormControl>
                      {/* Locked once collected: the amount stays the one the
                          admin set on the plan (the database enforces it too —
                          lock_collection_amount, 20261116000000). */}
                      <CurrencyInput {...field} disabled={!!entry && (entry.status === "Collected" || !!entry.collected)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("ct")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tCommon("optional")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="collectionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("planD")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("status")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {tStatus(s.toLowerCase())}
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
                name="serviceman"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("serviceman")}</FormLabel>
                    <FormControl>
                      <TechnicianCombobox value={field.value ?? ""} onChange={field.onChange} data-testid="collection-serviceman" />
                    </FormControl>
                    {showInheritedHint && (
                      <p className="flex items-center gap-1 text-xs text-success" data-testid="collection-serviceman-inherited">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("techniciansFromFilterChange")}
                      </p>
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
                name="preD"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("preD")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="collection-pre-d" />
                    </FormControl>
                    {showPreDHint && (
                      <p className="flex items-center gap-1 text-xs text-success" data-testid="collection-pre-d-inherited">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {t("preDFromFilterChange")}
                      </p>
                    )}
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
                name="paymentType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("paymentType")}</FormLabel>
                    <FormControl>
                      <Combobox value={field.value ?? ""} onChange={field.onChange} options={PAYMENT_TYPE_OPTIONS} placeholder="—" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isEdit && entry.collected && <CollectedAttributionFields control={form.control} />}
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
