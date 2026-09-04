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
import { useCreateFilterChangePlan, useUpdateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"
import type { FilterChangePlan } from "@/lib/types"

// A factory, not a module-scope constant — validation messages need t(),
// which only exists once useTranslation() has run inside the component (see
// the login page's own schema factories for the original precedent).
function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    orderNumber: z.string().min(1, t("requiredField", { field: tf("orderNumber") })),
    memberAccount: z.string().min(1, t("requiredField", { field: tf("memberAccount") })),
    filterType: z.string().min(1, t("requiredField", { field: tf("filter") })),
    planDate: z.string().min(1, t("requiredField", { field: tf("planD") })),
    contactNumber: z.string().optional(),
    address: z.string().optional(),
    sc: z.string().optional(),
    productNo: z.string().optional(),
    preD: z.string().optional(),
    accD: z.string().optional(),
    serviceman: z.string().optional(),
    note: z.string().optional(),
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
    note: "",
  }
}

export function FilterChangeFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNumber,
  plan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order Number when opened from an order's own detail page, so the
  // new record is tied to that order without the admin retyping it.
  defaultOrderNumber?: string
  // Editing an existing plan instead of creating a new one.
  plan?: FilterChangePlan
}) {
  const isEdit = !!plan
  const createPlan = useCreateFilterChangePlan()
  const updatePlan = useUpdateFilterChangePlan()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { t } = useTranslation("filterChange")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNumber, plan),
  })

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNumber, plan))
    // Same lookup the blur handler runs below — opening this dialog already
    // pointed at a real order (e.g. from that order's own detail page)
    // fills the rest in immediately, without needing the admin to click
    // into and back out of a field that's already correctly filled.
    if (!plan && defaultOrderNumber) handleOrderNumberBlur(defaultOrderNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNumber, plan])

  // Looks up the typed order number against the customers table (one row
  // per order — see customer-lookup.ts) the moment the admin tabs off the
  // field, and fills in whatever it finds — but only into fields still
  // empty, so it can never overwrite something already typed here, whether
  // that happened before or after this fires. Add-only: while editing an
  // existing plan every field already has real data, so this would have
  // nothing to safely fill anyway.
  function handleOrderNumberBlur(orderNumber: string) {
    if (isEdit) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, orderNumber)
    if (!customer) return
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
  }

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      contactNumber: values.contactNumber ?? "",
      address: values.address ?? "",
      sc: values.sc ?? "",
      productNo: values.productNo ?? "",
      serviceman: values.serviceman ?? "",
    }
    if (isEdit) {
      await updatePlan.mutateAsync({ id: plan.id, input })
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // unlike auto-generated recurring-schedule/C/T-completion rows, which
      // stay at the 'Confirmed' default set at the database layer (see the
      // dispatch_confirmation_workflow migration).
      await createPlan.mutateAsync({ ...input, status: "Pending", dispatchStatus: "Draft" })
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
                name="orderNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("orderNumber")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="001-0001"
                        {...field}
                        onBlur={(e) => {
                          field.onBlur()
                          handleOrderNumberBlur(e.target.value)
                        }}
                      />
                    </FormControl>
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
                      <Input placeholder={t("accountOrCompanyName")} {...field} />
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
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{tFields("address")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("serviceAddress")} {...field} />
                    </FormControl>
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
                    <FormControl>
                      <Input placeholder={t("technicianName")} {...field} />
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
