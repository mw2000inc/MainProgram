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
import { useCreateCustomer, useUpdateCustomer } from "@/lib/hooks/use-customers"
import type { Customer } from "@/lib/types"

const schema = z.object({
  memberAccountNumber: z.string().min(1, "Member Account#0 is required"),
  companyName: z.string().min(1, "Account Name is required"),
  // Account Contact Person (= fullName) has no minimum length — optional.
  fullName: z.string(),
  contactNumber: z.string().min(7, "Enter a valid contact number"),
  contactNumber2: z.string().optional(),
  address: z.string().min(5, "Address is required"),
  email: z.string().email("Enter a valid email address").or(z.literal("")),
  tin: z.string().optional(),
  notes: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

function defaultValues(customer?: Customer): FormValues {
  return {
    memberAccountNumber: customer?.memberAccountNumber ?? "",
    fullName: customer?.fullName ?? "",
    companyName: customer?.companyName ?? "",
    address: customer?.address ?? "",
    email: customer?.email ?? "",
    contactNumber: customer?.contactNumber ?? "",
    contactNumber2: customer?.contactNumber2 ?? "",
    tin: customer?.tin ?? "",
    notes: customer?.notes ?? "",
  }
}

// Water Purification Type, Contract Start/End Date, Assigned Technician, and
// Water Filter Installed are no longer collected on this form, but the
// customers table still requires contract_start/contract_end/dispenser_type on
// insert — new members get these silent defaults; existing members are simply
// left untouched on edit (the update payload never includes these keys).
function newMemberDefaults() {
  const today = new Date()
  const oneYearLater = new Date(today)
  oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
  return {
    dispenserType: "",
    contractStart: today.toISOString().slice(0, 10),
    contractEnd: oneYearLater.toISOString().slice(0, 10),
    assignedTechnician: "",
    filterInstalled: false,
  }
}

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer?: Customer
  onCreated?: (customer: Customer) => void
}) {
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const isEdit = !!customer

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(customer),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(customer))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer])

  async function onSubmit(values: FormValues) {
    if (isEdit) {
      await updateCustomer.mutateAsync({ id: customer.id, input: values })
    } else {
      const created = await createCustomer.mutateAsync({ ...values, ...newMemberDefaults() })
      onCreated?.(created)
    }
    onOpenChange(false)
  }

  const pending = createCustomer.isPending || updateCustomer.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Member" : "Add Member"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update member details." : "Register a new member."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="memberAccountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member Account#0</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 0007-000-0000-0006" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Golden Harvest Corp." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Contact Person (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Juan Dela Cruz" {...field} />
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
                    <FormLabel>Contact Number1 (Main)</FormLabel>
                    <FormControl>
                      <Input placeholder="09171234567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactNumber2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Number2 (Sub, Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
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
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St., Quezon City" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="juan@mail.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TIN # (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="Optional notes about this member..." {...field} />
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
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Add Member"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
