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
import type { RepairPlan } from "@/lib/types"

const schema = z.object({
  issuedDate: z.string().min(1, "Date is required"),
  orderNo: z.string().min(1, "Select an order number"),
  problem: z.string().min(1, "Problem is required"),
  solutionStatus: z.string().optional(),
  preD: z.string().optional(),
  accD: z.string().optional(),
  th: z.string().min(1, "Select a technician"),
  partNo: z.string().optional(),
  amt: z.string().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "Must be zero or more"),
  unitInOut: z.string().min(1),
})

type FormValues = z.infer<typeof schema>

function defaultValues(defaultDate: string, defaultOrderNo?: string, plan?: RepairPlan): FormValues {
  if (plan) {
    return {
      issuedDate: plan.issuedDate,
      orderNo: plan.orderNo,
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
  // Pre-fills Order No. when opened from an order's own detail page — only
  // takes effect if a customer with a matching order number exists, since
  // this field is a select sourced from the customers list.
  defaultOrderNo?: string
  // Editing an existing plan instead of creating a new one.
  plan?: RepairPlan
}) {
  const isEdit = !!plan
  const createPlan = useCreateRepairPlan()
  const updatePlan = useUpdateRepairPlan()
  const { data: customers = [] } = useCustomers()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNo, plan),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, defaultOrderNo, plan))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNo, plan])

  async function onSubmit(values: FormValues) {
    const customer = customers.find((c) => c.orderNumber === values.orderNo)
    const input = {
      ...values,
      accountName: customer?.companyName || customer?.fullName || plan?.accountName || "",
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
          <DialogTitle>{isEdit ? "Edit Repair Plan" : "Add Repair Plan"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this repair record." : "Log a repair request for a customer's order."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="issuedDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Issued Date</FormLabel>
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
                  <FormLabel>Order No.</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select order number" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.orderNumber}>
                          {c.orderNumber} — {c.companyName || c.fullName}
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
              name="problem"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Problem</FormLabel>
                  <FormControl>
                    <Input placeholder="Describe the issue" {...field} />
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
                  <FormLabel>Solution / Status</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
                  <FormLabel>Pre D</FormLabel>
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
                  <FormLabel>Acc D</FormLabel>
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
                  <FormLabel>TH</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select technician" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TECHNICIANS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
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
                  <FormLabel>Part No</FormLabel>
                  <FormControl>
                    <Input placeholder="Optional" {...field} />
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
                  <FormLabel>AMT</FormLabel>
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
                  <FormLabel>Unit IN/OUT</FormLabel>
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
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
