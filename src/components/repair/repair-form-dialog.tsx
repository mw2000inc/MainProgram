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
import { TECHNICIANS } from "@/lib/constants"
import { useCreateRepairPlan, useUpdateRepairPlan } from "@/lib/hooks/use-repair-plans"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { toast } from "sonner"
import type { RepairPlan } from "@/lib/types"

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    issuedDate: z.string().min(1, t("requiredField", { field: tf("issuedDate") })),
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNo") })),
    // Previously derived silently on submit from whichever customer's
    // orderNumber happened to match (only possible because Order No. used
    // to be a required Select of existing customers, guaranteeing a match).
    // Now a real, visible field — Order No. is free text and can refer to
    // an order with no customer record at all, so there has to be somewhere
    // for the admin to type a name in that case.
    accountName: z.string().min(1, t("requiredField", { field: tf("accountName") })),
    problem: z.string().min(1, t("requiredField", { field: tf("problem") })),
    solutionStatus: z.string().optional(),
    preD: z.string().optional(),
    accD: z.string().optional(),
    th: z.string().min(1, t("selectField", { field: tf("serviceman") })),
    partNo: z.string().optional(),
    amt: z.string().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), t("mustBeZeroOrMore")),
    unitInOut: z.string().min(1),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNo?: string, plan?: RepairPlan): FormValues {
  if (plan) {
    return {
      issuedDate: plan.issuedDate,
      orderNo: plan.orderNo,
      accountName: plan.accountName,
      problem: plan.problem,
      solutionStatus: plan.solutionStatus ?? "",
      preD: plan.preD ?? "",
      accD: plan.accD ?? "",
      th: plan.th,
      partNo: plan.partNo ?? "",
      amt: String(plan.amt),
      unitInOut: plan.unitInOut,
    }
  }
  return {
    issuedDate: defaultDate,
    orderNo: defaultOrderNo ?? "",
    accountName: "",
    problem: "",
    solutionStatus: "",
    preD: "",
    accD: "",
    th: "",
    partNo: "",
    amt: "0",
    unitInOut: "In",
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

  // See filter-change-form-dialog.tsx's own comment on this same pattern —
  // fills accountName only if it's still empty, add-only. Repair has no
  // contact/address columns, so accountName is the only field to fill.
  function handleOrderNoBlur(orderNo: string) {
    if (isEdit) return
    const customer = findCustomerByOrderNumber(customers, saleListEntries, orderNo)
    if (!customer) return
    const name = customer.companyName || customer.fullName
    if (name && !form.getValues("accountName").trim()) {
      form.setValue("accountName", name)
      toast.success(tCommon("customerInfoFilled"))
    }
  }

  React.useEffect(() => {
    if (!open) return
    form.reset(defaultValues(defaultDate, defaultOrderNo, plan))
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
      amt: Number(values.amt),
    }
    if (isEdit) {
      await updatePlan.mutateAsync({ id: plan.id, input })
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // see the dispatch_confirmation_workflow migration.
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
                    <Input placeholder={t("customerOrBusinessName")} {...field} />
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
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectTechnician")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TECHNICIANS.map((tech) => (
                        <SelectItem key={tech} value={tech}>
                          {tech}
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
                    <Input type="number" step="0.01" min="0" {...field} />
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
  )
}
