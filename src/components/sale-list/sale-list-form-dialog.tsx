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
import { useCreateSaleListEntry, useUpdateSaleListEntry } from "@/lib/hooks/use-sale-list"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import type { SaleListEntry, SaleListStatus } from "@/lib/types"

const STATUSES: SaleListStatus[] = ["ACTIVE", "INACTIVE", "RENT"]

const schema = z.object({
  orderNumber: z.string().min(1, "Order number is required"),
  installedDate: z.string().optional(),
  // "Account#" links to an existing Member rather than free text.
  customerId: z.string().min(1, "Select a member"),
  productNo: z.string().optional(),
  sc: z.string().optional(),
  cf: z.string().optional(),
  ct: z.string().optional(),
  cpY1Y2: z.string().optional(),
  cpStart: z.string().optional(),
  cpEnd: z.string().optional(),
  note: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "RENT"]),
  // Which CP System catalog entry (see /cp-system) is installed for this
  // order — optional, since not every order has been tagged yet.
  cpSystemId: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function defaultValues(entry?: SaleListEntry, defaultCustomerId?: string): FormValues {
  if (entry) {
    return {
      orderNumber: entry.orderNumber,
      installedDate: entry.installedDate ?? "",
      customerId: entry.customerId ?? "",
      productNo: entry.productNo,
      sc: entry.sc,
      cf: entry.cf,
      ct: entry.ct,
      cpY1Y2: entry.cpY1Y2,
      cpStart: entry.cpStart ?? "",
      cpEnd: entry.cpEnd ?? "",
      note: entry.note ?? "",
      status: entry.status,
      cpSystemId: entry.cpSystemId ?? "",
    }
  }
  return {
    orderNumber: "",
    installedDate: "",
    customerId: defaultCustomerId ?? "",
    productNo: "",
    sc: "",
    cf: "",
    ct: "",
    cpY1Y2: "",
    cpStart: "",
    cpEnd: "",
    note: "",
    status: "ACTIVE",
    cpSystemId: "",
  }
}

export function SaleListFormDialog({
  open,
  onOpenChange,
  entry,
  defaultCustomerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Editing an existing entry instead of creating a new one.
  entry?: SaleListEntry
  // Pre-selects the Account# (Member) field when adding a new entry from a
  // member's own Related Sales section.
  defaultCustomerId?: string
}) {
  const isEdit = !!entry
  const createEntry = useCreateSaleListEntry()
  const updateEntry = useUpdateSaleListEntry()
  const { data: customers = [] } = useCustomers()
  const { data: cpSystems = [] } = useCpSystems()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(entry, defaultCustomerId),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(entry, defaultCustomerId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultCustomerId])

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      productNo: values.productNo ?? "",
      sc: values.sc ?? "",
      cf: values.cf ?? "",
      ct: values.ct ?? "",
      cpY1Y2: values.cpY1Y2 ?? "",
      cpSystemId: values.cpSystemId ?? "",
    }
    if (isEdit) {
      await updateEntry.mutateAsync({ id: entry.id, input })
    } else {
      await createEntry.mutateAsync(input)
    }
    onOpenChange(false)
  }

  const pending = createEntry.isPending || updateEntry.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Sale List Entry" : "Add Sale List Entry"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this member's install / care-plan coverage." : "Track a member's install / care-plan coverage."}
          </DialogDescription>
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
                      <Input placeholder="001-0001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account# (Member)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select member" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.memberAccountNumber ? `${c.memberAccountNumber} — ` : ""}
                            {c.companyName || c.fullName}
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
                name="productNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product#</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 101 / MW) F7" {...field} />
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
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpSystemId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CP System</FormLabel>
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select system" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {cpSystems.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.systemCode}
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
                name="cf"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>C/F</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
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
                    <FormLabel>C/T</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpY1Y2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CP y1/y2</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CP start</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cpEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CP end</FormLabel>
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
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
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
