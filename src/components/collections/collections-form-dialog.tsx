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
import { useCreateCollection, useUpdateCollection } from "@/lib/hooks/use-collections"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { CollectionPlan } from "@/lib/types"

// This form had no way to actually mark a collection Collected before —
// status could only ever be read, never changed, from this dialog. Matches
// the Pending/Completed/Cancelled convention already used by every other
// plan table's status (see PlanStatusBadge) — "Collected" instead of
// "Completed" since that's this domain's own natural word for it (and
// PlanStatusBadge already recognizes it as the same success tone).
const STATUS_OPTIONS = ["Pending", "Collected", "Cancelled"] as const

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    orderNo: z.string().min(1, t("requiredField", { field: tf("orderNumber") })),
    accountName: z.string().min(1, t("requiredField", { field: tf("memberAccount") })),
    amount: z
      .string()
      .min(1, t("requiredField", { field: tf("amount") }))
      .refine((v) => !Number.isNaN(Number(v)) && Number(v) >= 0, t("mustBeZeroOrMore")),
    ct: z.string().optional(),
    collectionDate: z.string().min(1, t("requiredField", { field: tf("planD") })),
    status: z.string().min(1),
    preD: z.string().optional(),
    accD: z.string().optional(),
    note: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, defaultOrderNo?: string, entry?: CollectionPlan): FormValues {
  if (entry) {
    return {
      orderNo: entry.orderNo,
      accountName: entry.accountName,
      amount: String(entry.amount),
      ct: entry.ct,
      collectionDate: entry.collectionDate,
      status: entry.status || "Pending",
      preD: entry.preD ?? "",
      accD: entry.accD ?? "",
      note: entry.note ?? "",
    }
  }
  return {
    orderNo: defaultOrderNo ?? "",
    accountName: "",
    amount: "0",
    ct: "",
    collectionDate: defaultDate,
    status: "Pending",
    preD: "",
    accD: "",
    note: "",
  }
}

export function CollectionsFormDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultOrderNo,
  entry,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Pre-fills Order Number when opened from an order's own detail page.
  defaultOrderNo?: string
  // Editing an existing collection instead of creating a new one.
  entry?: CollectionPlan
}) {
  const isEdit = !!entry
  const createCollection = useCreateCollection()
  const updateCollection = useUpdateCollection()
  const { t } = useTranslation("collection")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, defaultOrderNo, entry),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, defaultOrderNo, entry))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, defaultOrderNo, entry])

  async function onSubmit(values: FormValues) {
    const input = { ...values, amount: Number(values.amount), ct: values.ct ?? "" }
    if (isEdit) {
      await updateCollection.mutateAsync({ id: entry.id, input })
    } else {
      // A new manually-scheduled dispatch enters the admin approval queue —
      // see the dispatch_confirmation_workflow migration.
      await createCollection.mutateAsync({ ...input, dispatchStatus: "Draft" })
    }
    onOpenChange(false)
  }

  const pending = createCollection.isPending || updateCollection.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? (entry.source === "recurring_schedule" ? t("editScheduleTitle") : t("editTitle")) : t("addTitle")}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? entry.source === "recurring_schedule"
                ? t("recurringScheduleDescription")
                : t("editDescription")
              : t("addDescription")}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="orderNo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("orderNumber")}</FormLabel>
                    <FormControl>
                      <Input placeholder="SK001-0001" {...field} />
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
                    <FormLabel>{tFields("memberAccount")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("customerOrBusinessName")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("amount")}</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} />
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
                    <FormLabel>{tFields("ct")}</FormLabel>
                    <FormControl>
                      <Input placeholder={tCommon("optional")} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="collectionDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tFields("planD")}</FormLabel>
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
                    <FormLabel>{tFields("status")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {tStatus(s.toLowerCase())}
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
                name="note"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{tFields("note")}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} placeholder={tCommon("optionalNotes")} {...field} />
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
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : tCommon("add")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
