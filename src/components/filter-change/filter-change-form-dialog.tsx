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
import { useCreateFilterChangePlan } from "@/lib/hooks/use-filter-change-plans"

const schema = z.object({
  orderNumber: z.string().min(1, "Order number is required"),
  memberAccount: z.string().min(1, "Member account is required"),
  filterType: z.string().min(1, "Filter type is required"),
  planDate: z.string().min(1, "Date is required"),
  contactNumber: z.string().optional(),
  address: z.string().optional(),
  sc: z.string().optional(),
  productNo: z.string().optional(),
  preD: z.string().optional(),
  accD: z.string().optional(),
  serviceman: z.string().optional(),
  note: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function defaultValues(defaultDate: string): FormValues {
  return {
    orderNumber: "",
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
}) {
  const createPlan = useCreateFilterChangePlan()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate])

  async function onSubmit(values: FormValues) {
    await createPlan.mutateAsync({
      ...values,
      contactNumber: values.contactNumber ?? "",
      address: values.address ?? "",
      sc: values.sc ?? "",
      productNo: values.productNo ?? "",
      serviceman: values.serviceman ?? "",
      status: "Pending",
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Add Filter Change Plan</DialogTitle>
          <DialogDescription>Schedule a filter change for a customer&apos;s order.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="orderNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order Number</FormLabel>
                    <FormControl>
                      <Input placeholder="SK001-0001" {...field} />
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
                    <FormLabel>Member Account#</FormLabel>
                    <FormControl>
                      <Input placeholder="Account or company name" {...field} />
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
                    <FormLabel>Filter</FormLabel>
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
                    <FormLabel>Contact #</FormLabel>
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
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="Service address" {...field} />
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
                    <FormLabel>S/C</FormLabel>
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
                    <FormLabel>Product #</FormLabel>
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
                name="serviceman"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serviceman</FormLabel>
                    <FormControl>
                      <Input placeholder="Technician name" {...field} />
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
                    <FormLabel>Date</FormLabel>
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
                    <FormLabel>Note</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder="Optional notes..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPlan.isPending}>
                {createPlan.isPending ? "Saving..." : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
