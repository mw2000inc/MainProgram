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
import { useTranslation } from "@/lib/i18n/i18n-context"
import { newMemberDefaults } from "@/lib/customer-defaults"
import type { Customer } from "@/lib/types"

function createSchema(
  t: (key: string) => string,
  tCommon: (key: string, params?: Record<string, string>) => string,
  tf: (key: string) => string
) {
  return z.object({
    memberAccountNumber: z.string().min(1, tCommon("requiredField", { field: t("memberAccountNumber0") })),
    companyName: z.string().min(1, tCommon("requiredField", { field: tf("accountName") })),
    // Account Contact Person (= fullName) has no minimum length — optional.
    fullName: z.string(),
    contactNumber: z.string().min(7, tCommon("enterValidField", { field: tf("contactNumber") })),
    contactNumber2: z.string().optional(),
    address: z.string().min(5, tCommon("requiredField", { field: tf("address") })),
    email: z.string().email(t("enterValidEmail")).or(z.literal("")),
    tin: z.string().optional(),
    notes: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

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
// insert — new members get these silent defaults (see customer-defaults.ts,
// shared with Install's own auto-create-a-member flow); existing members are
// simply left untouched on edit (the update payload never includes these keys).

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
  const { t } = useTranslation("member")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(t, tCommon, tFields), [t, tCommon, tFields])

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
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="memberAccountNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("memberAccountNumber0")}</FormLabel>
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
                    <FormLabel>{tFields("accountName")}</FormLabel>
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
                    <FormLabel>{t("accountContactPersonOptional")}</FormLabel>
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
                    <FormLabel>{t("contactNumber1Main")}</FormLabel>
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
                    <FormLabel>{t("contactNumber2SubOptional")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tCommon("optional")} {...field} />
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
                    <FormLabel>{tFields("address")}</FormLabel>
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
                    <FormLabel>{t("emailAddress")}</FormLabel>
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
                    <FormLabel>{t("tinOptional")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tCommon("optional")} {...field} />
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
                    <FormLabel>{tFields("note")}</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder={t("notesPlaceholder")} {...field} />
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
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : t("addMember")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
