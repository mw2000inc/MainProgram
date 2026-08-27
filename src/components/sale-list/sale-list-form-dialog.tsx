"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { addMonths, addYears, format, parseISO } from "date-fns"
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { useCreateSaleListEntry, useUpdateSaleListEntry } from "@/lib/hooks/use-sale-list"
import { useCustomers } from "@/lib/hooks/use-customers"
import { PRODUCT_CATALOG, formatProductOption } from "@/lib/constants"
import type { SaleListEntry, SaleListStatus } from "@/lib/types"

const STATUSES: SaleListStatus[] = ["ACTIVE", "INACTIVE", "RENT"]

const PRODUCT_OPTIONS: ComboboxOption[] = PRODUCT_CATALOG.flatMap((g) =>
  g.items.map((item) => ({ value: formatProductOption(item.code, item.name), group: g.group }))
)

// Suggestions offered in the C/T combobox — still a real text input (a
// custom value is always accepted if none of these fit), just with these
// offered below it.
const CT_OPTIONS: ComboboxOption[] = ["Yearly", "Half Year", "Quarterly", "Monthly"].map((value) => ({ value }))

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
  }
}

// C/T is a free-typed combobox (see CT_OPTIONS), not a fixed enum, so this
// always needs a default for anything that isn't one of the three shorter
// intervals below — that covers "Yearly" itself, a blank/unset C/T, and any
// other custom value someone types, all falling back to the original
// add-one-year behavior.
function calculateCpEnd(cpStartStr: string, ct: string | undefined): string {
  const start = parseISO(cpStartStr)
  switch (ct) {
    case "Monthly":
      return format(addMonths(start, 1), "yyyy-MM-dd")
    case "Quarterly":
      return format(addMonths(start, 3), "yyyy-MM-dd")
    case "Half Year":
      return format(addMonths(start, 6), "yyyy-MM-dd")
    default:
      return format(addYears(start, 1), "yyyy-MM-dd")
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

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(entry, defaultCustomerId),
  })

  // Tracks whether CP end has been set by the admin directly (typing in that
  // field — see the Input's onChange below) rather than by our own auto-fill.
  // Starts true on edit when a CP end is already saved, so opening an
  // existing entry never silently overwrites it; starts false for a new
  // entry / a blank CP end, so the very next CP start edit fills it in.
  const cpEndTouchedRef = React.useRef(!!entry?.cpEnd)
  const cpStartValue = form.watch("cpStart")
  const ctValue = form.watch("ct")

  React.useEffect(() => {
    if (open) form.reset(defaultValues(entry, defaultCustomerId))
    cpEndTouchedRef.current = !!entry?.cpEnd
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, defaultCustomerId])

  React.useEffect(() => {
    if (!cpStartValue || cpEndTouchedRef.current) return
    form.setValue("cpEnd", calculateCpEnd(cpStartValue, ctValue))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpStartValue, ctValue])

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      productNo: values.productNo ?? "",
      sc: values.sc ?? "",
      cf: values.cf ?? "",
      ct: values.ct ?? "",
      cpY1Y2: values.cpY1Y2 ?? "",
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
                      {/* Same combobox pattern as C/T below — a real text input
                          (so a value outside the catalog, e.g. legacy data, is
                          still typable/editable), with the catalog offered as
                          a dropdown anchored directly below the field. */}
                      <Combobox
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={PRODUCT_OPTIONS}
                        placeholder="e.g. 101 / MW) F7"
                      />
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
                    <FormLabel>C/T (Optional)</FormLabel>
                    <FormControl>
                      <Combobox
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={CT_OPTIONS}
                        placeholder="e.g. Yearly"
                      />
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
                      {/* Auto-filled to one year after CP start (see the effect
                          above) until the admin edits this field directly —
                          marked here, not on the auto-fill's own setValue call. */}
                      <Input
                        type="date"
                        {...field}
                        onChange={(e) => {
                          cpEndTouchedRef.current = true
                          field.onChange(e)
                        }}
                      />
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
