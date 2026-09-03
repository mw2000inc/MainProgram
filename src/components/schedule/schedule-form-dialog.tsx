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
import { TECHNICIANS } from "@/lib/constants"
import { useCreateScheduleJob, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useUsers } from "@/lib/hooks/use-misc"
import { JOB_TYPE_LABELS } from "@/components/schedule/schedule-columns"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

const JOB_TYPES = Object.keys(JOB_TYPE_LABELS) as ScheduleJobType[]
const STATUSES: ScheduleJobStatus[] = ["pending", "completed", "cancelled"]

// Radix Select forbids an empty-string item value, so "none selected" needs
// its own sentinel — mapped back to "" (unset) on submit. Shared by every
// optional Select on this form (second technician, linked technician
// account).
const NONE_SENTINEL = "__none__"

function createSchema(t: (key: string) => string, tCommon: (key: string, params?: Record<string, string>) => string) {
  return z.object({
    jobType: z.custom<ScheduleJobType>((v) => typeof v === "string" && v.length > 0, t("selectJobType")),
    technician: z.string().min(1, t("selectTechnician")),
    // Optional second technician — most jobs only need the one above; this is
    // only for jobs that genuinely need two people (e.g. pull-out + install).
    technician2: z.string().optional(),
    orderNo: z.string().optional(),
    scheduledDate: z.string().min(1, tCommon("requiredField", { field: t("date") })),
    // Free text ("ANYTIME", "MORNING", "2:00 PM") — see ScheduleJob.scheduledTime.
    scheduledTime: z.string().optional(),
    status: z.custom<ScheduleJobStatus>((v) => typeof v === "string" && v.length > 0, t("selectStatus")),
    notes: z.string().optional(),
    // A second location for this same job (e.g. pull-out vs install address).
    secondaryAddress: z.string().optional(),
    // Links this job to a real technician account, purely for that
    // technician's "my schedule" RLS scoping — separate from the technician/
    // technician2 name fields above, which stay the source of truth for
    // display/print/export.
    technicianUserId: z.string().optional(),
    // Same purpose as technicianUserId, for the technician2 name field — lets
    // the second technician's own account see this shared job too.
    technician2UserId: z.string().optional(),
    // Filter-change inventory deduction — which item + how many units to
    // deduct once this job is marked completed. Only meaningful when jobType
    // is "filter_change", but kept as plain optional fields on the shared form
    // rather than a separate dialog.
    productId: z.string().optional(),
    quantity: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(defaultDate: string, job?: ScheduleJob): FormValues {
  if (job) {
    return {
      jobType: job.jobType,
      technician: job.technician,
      technician2: job.technician2 ?? NONE_SENTINEL,
      orderNo: job.orderNo ?? "",
      scheduledDate: job.scheduledDate,
      scheduledTime: job.scheduledTime ?? "",
      status: job.status,
      notes: job.notes ?? "",
      productId: job.productId ?? "",
      quantity: job.quantity !== undefined ? String(job.quantity) : "",
      secondaryAddress: job.secondaryAddress ?? "",
      technicianUserId: job.technicianUserId ?? NONE_SENTINEL,
      technician2UserId: job.technician2UserId ?? NONE_SENTINEL,
    }
  }
  return {
    jobType: "other",
    technician: "",
    technician2: NONE_SENTINEL,
    orderNo: "",
    scheduledDate: defaultDate,
    scheduledTime: "",
    status: "pending",
    notes: "",
    productId: "",
    quantity: "",
    secondaryAddress: "",
    technicianUserId: NONE_SENTINEL,
    technician2UserId: NONE_SENTINEL,
  }
}

export function ScheduleFormDialog({
  open,
  onOpenChange,
  defaultDate,
  job,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Editing an existing job instead of scheduling a new one.
  job?: ScheduleJob
}) {
  const isEdit = !!job
  const createJob = useCreateScheduleJob()
  const updateJob = useUpdateScheduleJob()
  const { data: products = [] } = useProducts()
  const { data: users = [] } = useUsers()
  const technicianAccounts = React.useMemo(() => users.filter((u) => u.role === "technician"), [users])
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const schema = React.useMemo(() => createSchema(t, tCommon), [t, tCommon])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, job),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, job))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, job])

  const jobType = form.watch("jobType")
  const isFilterChange = jobType === "filter_change"
  const technician2Value = form.watch("technician2")
  const technicianValue = form.watch("technician")
  const hasSecondTechnician = !!technician2Value && technician2Value !== NONE_SENTINEL

  async function onSubmit(values: FormValues) {
    const input = {
      ...values,
      technician2: values.technician2 && values.technician2 !== NONE_SENTINEL ? values.technician2 : undefined,
      // "" (not undefined) so toRow's `!== undefined` check still fires and
      // actually clears technician_user_id in the DB when an edit sets this
      // back to "None" — undefined here would make toRow skip the field
      // entirely, silently leaving a stale link in place.
      technicianUserId: values.technicianUserId && values.technicianUserId !== NONE_SENTINEL ? values.technicianUserId : "",
      technician2UserId:
        values.technician2UserId && values.technician2UserId !== NONE_SENTINEL ? values.technician2UserId : "",
      // Deduction fields only mean anything for filter-change jobs — don't
      // carry a stale product/quantity along if the type gets switched away.
      productId: isFilterChange ? values.productId || undefined : undefined,
      quantity: isFilterChange && values.quantity ? Number(values.quantity) : undefined,
    }
    if (isEdit) {
      await updateJob.mutateAsync({ id: job.id, input })
    } else {
      await createJob.mutateAsync(input)
    }
    onOpenChange(false)
  }

  const pending = createJob.isPending || updateJob.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editJobTitle") : t("scheduleAJobTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editJobDescription") : t("addJobDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="jobType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("jobType")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectJobType")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {JOB_TYPES.map((jt) => (
                        <SelectItem key={jt} value={jt}>
                          {t(jt)}
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
              name="technician"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technician")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectTechnician")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TECHNICIANS.map((tech) => (
                        <SelectItem key={tech} value={tech}>
                          {tech}
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
              name="technician2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("secondTechnicianOptional")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("addSecondTechnicianPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>{tCommon("none")}</SelectItem>
                      {TECHNICIANS.map((tech) => (
                        <SelectItem key={tech} value={tech}>
                          {tech}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* There's deliberately no separate date field for the second
                      technician — the Date field below applies to this one
                      shared job, so both technicians are always on it together. */}
                  {field.value && field.value !== NONE_SENTINEL && (
                    <p className="text-xs text-muted-foreground">{t("sharesSameDateNote")}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="technicianUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technicianAccountOptional")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("linkToTechnicianLogin")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>{tCommon("none")}</SelectItem>
                      {technicianAccounts.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Separate from the Technician name field above — that one
                      is what shows/prints/exports; this is only so the
                      linked account's own Schedule view can find this job.
                      Leave unset if this technician doesn't have a login
                      yet. */}
                  <p className="text-xs text-muted-foreground">{t("linksTechnicianScheduleNote")}</p>
                  <FormMessage />
                </FormItem>
              )}
            />
            {hasSecondTechnician && (
              <FormField
                control={form.control}
                name="technician2UserId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("technician2AccountOptional")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("linkToSecondTechnicianLogin")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_SENTINEL}>{tCommon("none")}</SelectItem>
                        {technicianAccounts.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("linksSecondTechnicianScheduleNote")}</p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="orderNo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("orderNoOptional")}</FormLabel>
                  <FormControl>
                    <Input placeholder="SK001-0001" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduledDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("date")}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  {hasSecondTechnician && (
                    <p className="text-xs text-muted-foreground">
                      {t("bothScheduledNote", {
                        technician: technicianValue || t("theFirstTechnician"),
                        technician2: technician2Value ?? "",
                      })}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduledTime"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("timeOptional")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("timePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="secondaryAddress"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("secondaryAddressOptional")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("secondaryAddressPlaceholder")} {...field} />
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
                        <SelectValue placeholder={t("selectStatus")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {tStatus(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isFilterChange && (
              <>
                <FormField
                  control={form.control}
                  name="productId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("filterToDeductOptional")}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("selectInventoryItem")} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.sku})
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
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("quantityToDeduct")}</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" step="1" placeholder="1" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("notesOptional")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder={tCommon("optionalNotes")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : t("scheduleButton")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
