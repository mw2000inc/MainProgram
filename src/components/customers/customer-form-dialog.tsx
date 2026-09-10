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
import { useCreateCustomer, useCustomers, useUpdateCustomer } from "@/lib/hooks/use-customers"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { newMemberDefaults } from "@/lib/customer-defaults"
import type { Customer } from "@/lib/types"

// Same normalization on both sides of every comparison below (trim +
// lowercase) — "0007-000-0000-0785" and " 0007-000-0000-0785 " or
// "0007-000-0000-0785 " typed with different casing/whitespace must still
// collide, matching what a person would consider "the same account
// number". Blank is never a duplicate — the database's own partial unique
// index (customers_member_account_number_unique_idx) excludes '' the same
// way, since at least one legitimate customer row has no account number
// assigned yet.
function normalizeAccountNumber(value: string): string {
  return value.trim().toLowerCase()
}

function createSchema(
  t: (key: string) => string,
  tCommon: (key: string, params?: Record<string, string>) => string,
  tf: (key: string) => string,
  // Every OTHER customer's own normalized member account number (never
  // includes the record being edited, and never includes blank) — the
  // submit-time safety net behind the Member Account# field's own onBlur
  // check below, so a duplicate can never get through some path that
  // skips blur (e.g. pasting then hitting Enter to submit immediately).
  existingAccountNumbers: Set<string>
) {
  return z
    .object({
      memberAccountNumber: z.string().min(1, tCommon("requiredField", { field: t("memberAccountNumber0") })),
      companyName: z.string().min(1, tCommon("requiredField", { field: tf("accountName") })),
      // Account Contact Person (= fullName) has no minimum length — optional.
      fullName: z.string(),
      // Optional, like contactNumber2 right below — not format/length-
      // validated at all (real contact numbers on file take many legitimate
      // shapes: "09171234567", "9171234567", "02 8123 4567",
      // "+63 917 123 4567", a landline, etc., and this app has no business
      // dictating what counts as a valid one), and not required either. The
      // customers.contact_number DB column is still `text not null` (no
      // migration needed) — this controlled input always submits a real
      // string, "" when left blank, which satisfies NOT NULL without being
      // NULL. Same pattern this form's own `email` field already uses for
      // the same reason (`customers.email` is also NOT NULL).
      contactNumber: z.string().optional(),
      contactNumber2: z.string().optional(),
      address: z.string().min(5, tCommon("requiredField", { field: tf("address") })),
      email: z.string().email(t("enterValidEmail")).or(z.literal("")),
      tin: z.string().optional(),
      notes: z.string().optional(),
    })
    .superRefine((values, ctx) => {
      const normalized = normalizeAccountNumber(values.memberAccountNumber)
      if (normalized && existingAccountNumbers.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["memberAccountNumber"],
          message: t("memberAccountNumberDuplicate"),
        })
      }
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
  const { data: customers = [] } = useCustomers()
  const isEdit = !!customer
  const { t } = useTranslation("member")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")

  // Every OTHER customer's own account number, normalized — excludes the
  // record being edited (so saving a customer with their own unchanged
  // Member Account# never falsely flags as a duplicate of itself) and
  // excludes blank (a blank account number is never a "duplicate", see
  // normalizeAccountNumber's own comment). useCustomers() is already
  // fetched app-wide (Member List's own table), so this adds no extra
  // query — just a client-side lookup, same instant feel as picking from
  // an already-loaded list.
  const existingAccountNumbers = React.useMemo(() => {
    const set = new Set<string>()
    for (const c of customers) {
      if (c.id === customer?.id) continue
      const normalized = normalizeAccountNumber(c.memberAccountNumber)
      if (normalized) set.add(normalized)
    }
    return set
  }, [customers, customer?.id])

  const schema = React.useMemo(
    () => createSchema(t, tCommon, tFields, existingAccountNumbers),
    [t, tCommon, tFields, existingAccountNumbers]
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(customer),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(customer))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer])

  async function onSubmit(values: FormValues) {
    // contactNumber is optional in the schema now, but customers.contact_number
    // is still `text not null` at the database level (no migration needed,
    // same reasoning as this form's own `email` field) — "" satisfies NOT
    // NULL without being NULL.
    const input = { ...values, contactNumber: values.contactNumber ?? "" }
    if (isEdit) {
      await updateCustomer.mutateAsync({ id: customer.id, input })
    } else {
      const created = await createCustomer.mutateAsync({ ...input, ...newMemberDefaults() })
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
                      <Input
                        placeholder="e.g. 0007-000-0000-0006"
                        {...field}
                        onBlur={() => {
                          field.onBlur()
                          // Immediate feedback the moment the admin tabs off
                          // this field, rather than only at submit — runs
                          // the exact same superRefine duplicate check
                          // above (trigger() re-validates against the full
                          // schema regardless of the form's onSubmit-only
                          // validation mode), so there's only one place
                          // this rule is ever defined.
                          form.trigger("memberAccountNumber")
                        }}
                      />
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
                      {/* autoComplete="off" + a non-standard name to actually
                          suppress Chrome's own remembered-value dropdown —
                          plain off alone is well known to be ignored by
                          Chrome for a field it's decided looks like a phone
                          number. The name override is safe here: this is a
                          controlled field (value/onChange from RHF's field
                          object, not native form submission), so nothing
                          reads the DOM name back for state — only the
                          browser's autofill heuristics see it. */}
                      <Input placeholder="09171234567" {...field} autoComplete="off" name="member-contact-number-1" />
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
                      <Input placeholder={tCommon("optional")} {...field} autoComplete="off" name="member-contact-number-2" />
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
