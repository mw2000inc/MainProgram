"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { UserCheck, UserSearch } from "lucide-react"
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
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
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
import { findExistingMemberMatch, type MemberMatch } from "@/lib/customer-lookup"
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
  // True only when this dialog was explicitly opened to edit a specific
  // record (row menu's Edit) — the find-existing-member search/detection
  // below only makes sense for a genuine "Add Member" invocation, never
  // while already looking at one particular customer.
  const explicitEdit = !!customer
  const { t } = useTranslation("member")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")

  // Set once the admin confirms a detected/searched-for match really is the
  // member they meant (see applyMatch below) — from that point on this
  // dialog behaves exactly like editing that record: submitting updates it
  // instead of inserting a new, likely-duplicate row.
  const [matchedCustomer, setMatchedCustomer] = React.useState<Customer | null>(null)
  // A lower-confidence match surfaced passively as the admin fills out the
  // form organically (not via the search box) — never applied until the
  // admin clicks "Use This Member", so a coincidental partial match never
  // silently overwrites what's already been typed.
  const [possibleMatch, setPossibleMatch] = React.useState<MemberMatch | null>(null)
  // Once dismissed, a given match doesn't keep reappearing every time the
  // admin blurs another field this same dialog session.
  const [dismissedMatchIds, setDismissedMatchIds] = React.useState<Set<string>>(new Set())
  const [searchValue, setSearchValue] = React.useState("")

  // The record this form is actually operating on for existing-Member#
  // exclusion/submit purposes — whichever came first, an explicit Edit
  // invocation or a match the admin confirmed while adding.
  const effectiveTarget = customer ?? matchedCustomer ?? undefined

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
      if (c.id === effectiveTarget?.id) continue
      const normalized = normalizeAccountNumber(c.memberAccountNumber)
      if (normalized) set.add(normalized)
    }
    return set
  }, [customers, effectiveTarget?.id])

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

  // Resets the match-related state above whenever the dialog freshly opens
  // (or, while already open, switches to a different explicit-Edit record)
  // — done during render via the "adjust state when a prop changes" pattern
  // (see React's own docs on this) rather than in a useEffect, since a raw
  // useState setter call inside an effect body is flagged by this repo's
  // lint rules as a cascading-render risk. resetKey collapses open+customer
  // into one comparable value; null while closed means nothing resets on
  // close, matching the effect above's own `if (open)` guard.
  const resetKey = open ? (customer?.id ?? "__new__") : null
  const [lastResetKey, setLastResetKey] = React.useState(resetKey)
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey)
    if (resetKey !== null) {
      setMatchedCustomer(null)
      setPossibleMatch(null)
      setDismissedMatchIds(new Set())
      setSearchValue("")
    }
  }

  // Explicit search-box selection or "Use This Member" on a detected match
  // — both count as a deliberate admin confirmation, so both load
  // immediately with no further click needed (only the passive on-blur
  // detection itself waits for a click, see checkForMatch below).
  function applyMatch(matched: Customer) {
    setMatchedCustomer(matched)
    setPossibleMatch(null)
    setSearchValue("")
    form.reset(defaultValues(matched))
  }

  function clearMatch() {
    setMatchedCustomer(null)
    form.reset(defaultValues(undefined))
  }

  // Run from onBlur of Member Account#/Contact Number/Name — never while a
  // match is already loaded or this is an explicit Edit invocation (nothing
  // to detect against once the target record is already known).
  function checkForMatch() {
    if (matchedCustomer || explicitEdit) return
    const match = findExistingMemberMatch(customers, form.getValues())
    if (match && !dismissedMatchIds.has(match.customer.id)) setPossibleMatch(match)
  }

  function dismissPossibleMatch() {
    if (possibleMatch) setDismissedMatchIds((prev) => new Set(prev).add(possibleMatch.customer.id))
    setPossibleMatch(null)
  }

  const searchOptions = React.useMemo(() => {
    const map = new Map<string, Customer>()
    const options: ComboboxOption[] = []
    for (const c of customers) {
      if (c.isSystem) continue
      const name = c.companyName || c.fullName || t("unnamedMember")
      const phone = c.contactNumber || tCommon("none")
      const account = c.memberAccountNumber || tCommon("none")
      const label = `${name} • ${phone} • ${account}`
      // Skip the vanishingly rare exact-label collision rather than letting
      // a second customer silently overwrite the first in this map — keeps
      // this a non-issue instead of a silent wrong-record bug.
      if (map.has(label)) continue
      map.set(label, c)
      options.push({ value: label })
    }
    return { options, map }
  }, [customers, t, tCommon])

  async function onSubmit(values: FormValues) {
    // contactNumber is optional in the schema now, but customers.contact_number
    // is still `text not null` at the database level (no migration needed,
    // same reasoning as this form's own `email` field) — "" satisfies NOT
    // NULL without being NULL.
    const input = { ...values, contactNumber: values.contactNumber ?? "" }
    if (effectiveTarget) {
      await updateCustomer.mutateAsync({ id: effectiveTarget.id, input })
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
          <DialogTitle>{effectiveTarget ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{effectiveTarget ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {!explicitEdit && !matchedCustomer && (
              <div className="space-y-1.5">
                <FormLabel>{t("findExistingMemberLabel")}</FormLabel>
                <Combobox
                  value={searchValue}
                  onChange={(val) => {
                    setSearchValue(val)
                    const match = searchOptions.map.get(val)
                    if (match) applyMatch(match)
                  }}
                  options={searchOptions.options}
                  placeholder={t("findExistingMemberPlaceholder")}
                />
                <p className="text-xs text-muted-foreground">{t("findExistingMemberHint")}</p>
              </div>
            )}

            {!explicitEdit && matchedCustomer && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <UserCheck className="h-4 w-4 shrink-0 text-primary" />
                  <span>{t("existingMemberLoaded", { name: matchedCustomer.companyName || matchedCustomer.fullName })}</span>
                </div>
                <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={clearMatch}>
                  {t("startNewMemberInstead")}
                </Button>
              </div>
            )}

            {!explicitEdit && !matchedCustomer && possibleMatch && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2 text-sm">
                  <UserSearch className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-medium">{t("existingMemberFoundTitle")}</p>
                    <p className="text-muted-foreground">
                      {t(
                        possibleMatch.matchedOn === "memberAccountNumber"
                          ? "existingMemberFoundByAccountNumber"
                          : possibleMatch.matchedOn === "contactNumber"
                            ? "existingMemberFoundByPhone"
                            : "existingMemberFoundByName",
                        { name: possibleMatch.customer.companyName || possibleMatch.customer.fullName }
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={dismissPossibleMatch}>
                    {tCommon("dismiss")}
                  </Button>
                  <Button type="button" size="sm" onClick={() => applyMatch(possibleMatch.customer)}>
                    {t("useThisMember")}
                  </Button>
                </div>
              </div>
            )}

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
                          checkForMatch()
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
                      <Input
                        placeholder="Golden Harvest Corp."
                        {...field}
                        onBlur={() => {
                          field.onBlur()
                          checkForMatch()
                        }}
                      />
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
                      <Input
                        placeholder="Juan Dela Cruz"
                        {...field}
                        onBlur={() => {
                          field.onBlur()
                          checkForMatch()
                        }}
                      />
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
                      <Input
                        placeholder="09171234567"
                        {...field}
                        autoComplete="off"
                        name="member-contact-number-1"
                        onBlur={() => {
                          field.onBlur()
                          checkForMatch()
                        }}
                      />
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
                {pending ? tCommon("saving") : effectiveTarget ? tCommon("saveChanges") : t("addMember")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
