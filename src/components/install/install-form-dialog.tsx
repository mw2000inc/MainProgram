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
import type { InstallPlan } from "@/lib/types"

const money = z
  .string()
  .refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "Must be zero or more")

const schema = z.object({
  inputDate: z.string().min(1, "Date is required"),
  name: z.string().min(1, "Name is required"),
  address: z.string().optional(),
  contactNumber: z.string().optional(),
  model: z.string().min(1, "Select a model"),
  unitPrice: money,
  cpPrice: money,
  deliveryInstallationFee: money,
  preInstalledDate: z.string().optional(),
  installedDate: z.string().optional(),
  note: z.string().optional(),
  modelDp: z.string().optional(),
  orderNo: z.string().min(1, "Order number is required"),
  inOut: z.string().min(1),
})

type FormValues = z.infer<typeof schema>

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
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, plan),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, plan))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, plan])

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
      await createPlan.mutateAsync({ ...input, status: "Pending" })
    }
    onOpenChange(false)
  }

  const pending = createPlan.isPending || updatePlan.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Install Plan" : "Add Install Plan"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this installation." : "Schedule a new installation."}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="inputDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Input Date</FormLabel>
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
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Customer or business name" {...field} />
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
                      <Input placeholder="Installation address" {...field} />
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
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {DISPENSER_TYPES.map((t) => (
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
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit Price</FormLabel>
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
                    <FormLabel>C/P Price</FormLabel>
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
                    <FormLabel>Delivery &amp; Installation Fee</FormLabel>
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
                    <FormLabel>Pre Installed Date</FormLabel>
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
                    <FormLabel>Installed Date</FormLabel>
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
              <FormField
                control={form.control}
                name="modelDp"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model(dp)</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {DISPENSER_TYPES.map((t) => (
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
                name="orderNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Order No</FormLabel>
                    <FormControl>
                      <Input placeholder="SK001-0001" {...field} />
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
                    <FormLabel>In or Out</FormLabel>
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
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
