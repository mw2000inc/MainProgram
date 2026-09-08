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
import { isReasonableDateString } from "@/lib/form-schemas"
import { tomorrowIso } from "@/lib/utils"
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

const JOB_TYPES = Object.keys(JOB_TYPE_LABELS) as ScheduleJobType[]
// pending_approval included so editing an already-pending-approval job shows
// its real current status correctly in this dropdown (and an admin can
// manually set it back if they want) — the dedicated "Approve Schedule"
// button below is still the normal way to move it to 'pending'.
const STATUSES: ScheduleJobStatus[] = ["pending_approval", "pending", "completed", "cancelled"]

// Radix Select forbids an empty-string item value, so "none selected" needs
// its own sentinel — mapped back to "" (unset) on submit. Shared by every
// optional Select on this form (second technician, linked technician
// account).
const NONE_SENTINEL = "__none__"

// Technician jobs must be scheduled at least 1 day in advance — enforced
// here (not just the date input's `min` attribute) so a value can't reach
// the server via a manually-typed/pasted date the browser's own picker
// constraint doesn't stop. `originalDate` is the job's own scheduledDate
// when editing — left unchanged, an already-existing job's date is never
// forced through this check just because it happens to be today or in the
// past (e.g. editing a same-day job's remarks/status shouldn't suddenly
// fail validation over a field nobody touched); only an actual *move* to a
// new date has to land on tomorrow or later, same as a brand-new job.
function createSchema(
  t: (key: string) => string,
  tCommon: (key: string, params?: Record<string, string>) => string,
  originalDate?: string
) {
  return z.object({
    jobType: z.custom<ScheduleJobType>((v) => typeof v === "string" && v.length > 0, t("selectJobType")),
    technician: z.string().min(1, t("selectTechnician")),
    // Optional second technician — most jobs only need the one above; this is
    // only for jobs that genuinely need two people (e.g. pull-out + install).
    technician2: z.string().optional(),
    orderNo: z.string().optional(),
    scheduledDate: z
      .string()
      .min(1, tCommon("requiredField", { field: t("date") }))
      // Same sanity check as every other date field in the app (see
      // form-schemas.ts's own comment) — catches a malformed/extreme year
      // the date input's own `min` attribute never guards against (that
      // only sets a *lower* bound), before it reaches the database.
      .refine(isReasonableDateString, tCommon("invalidDate"))
      .refine((v) => v === originalDate || v >= tomorrowIso(), { message: t("scheduleAtLeastOneDayAhead") }),
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
      // Editing keeps the job's own existing date exactly as-is — even one
      // already today/in the past — the 1-day-advance rule only stops a
      // *new* date from landing there (see createSchema's own comment).
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
    // A brand-new job must land on tomorrow or later regardless of which
    // day's agenda this dialog was opened from — e.g. clicking "Schedule
    // Job" from *today's* Daily Report shouldn't default to a date the form
    // itself is about to reject. Any defaultDate already tomorrow or beyond
    // (opened from a future day) is left alone.
    scheduledDate: defaultDate < tomorrowIso() ? tomorrowIso() : defaultDate,
    scheduledTime: "",
    // Admin Schedule Approval workflow: a brand-new manually-created job
    // starts out awaiting approval, not immediately active — see the
    // schedule_pending_approval_status migration's own comment. Smart
    // Scheduling and the dispatch-confirm flow don't go through this form
    // at all (they insert 'pending' directly via find_or_create_schedule_job),
    // so they're completely unaffected by this default.
    status: "pending_approval",
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
  const schema = React.useMemo(() => createSchema(t, tCommon, job?.scheduledDate), [t, tCommon, job?.scheduledDate])
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
      // A brand-new manually-created job must always start at
      // 'pending_approval', never whatever the Status field happens to
      // hold — that field is hidden for a new job (see the FormField
      // below) specifically so there's nothing to pick here, but this is
      // the belt-and-suspenders guarantee: even if a value somehow reached
      // this payload for a create (a stale defaultValues call, devtools
      // tampering with form state, etc.), the actual submitted status is
      // still forced here rather than trusted from `values`. Editing an
      // existing job is unaffected — values.status is whatever the (visible,
      // for edits) dropdown has, unchanged.
      status: isEdit ? values.status : "pending_approval",
    }
    if (isEdit) {
      await updateJob.mutateAsync({ id: job.id, input })
    } else {
      await createJob.mutateAsync(input)
    }
    onOpenChange(false)
  }

  // Admin Schedule Approval workflow's explicit "Approve Schedule" action —
  // saves whatever the admin just edited (date, technician, etc. — "review
  // before approving" per the workflow) in the SAME update as moving
  // status from 'pending_approval' to 'pending', one write, same row. Only
  // ever wired up when editing an existing pending_approval job (see the
  // button below); createJob is never reached from here. Admin-only in
  // practice at the actual enforcement boundary — the update this sends
  // still goes through the ordinary schedule_jobs_update RLS policy plus
  // restrict_schedule_job_technician_update, which now rejects a non-admin
  // touching a pending_approval row outright (see the
  // schedule_pending_approval_rls_and_dedup migration) — not just a
  // client-side check.
  async function onApprove(values: FormValues) {
    if (!isEdit) return
    const input = {
      ...values,
      technician2: values.technician2 && values.technician2 !== NONE_SENTINEL ? values.technician2 : undefined,
      technicianUserId: values.technicianUserId && values.technicianUserId !== NONE_SENTINEL ? values.technicianUserId : "",
      technician2UserId:
        values.technician2UserId && values.technician2UserId !== NONE_SENTINEL ? values.technician2UserId : "",
      productId: isFilterChange ? values.productId || undefined : undefined,
      quantity: isFilterChange && values.quantity ? Number(values.quantity) : undefined,
      status: "pending" as ScheduleJobStatus,
    }
    await updateJob.mutateAsync({ id: job.id, input })
    onOpenChange(false)
  }

  const pending = createJob.isPending || updateJob.isPending
  const showApprove = isEdit && job?.status === "pending_approval"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Capped at 85vh (same convention customer-form-dialog.tsx already
          uses for its own long form) and turned into a flex column so the
          header and footer stay put while only the field list in between
          scrolls — this form gets long enough (extra Filter Change fields,
          a second technician's own fields) that the close button and
          Cancel/Schedule buttons could otherwise end up pushed off-screen
          with no way to reach them. */}
      <DialogContent onInteractOutside={(e) => e.preventDefault()} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editJobTitle") : t("scheduleAJobTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editJobDescription") : t("addJobDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          {/* id + the footer's submit button below referencing it by
              `form=` is what lets the footer live outside this element
              (so it isn't part of the scrolling area) while still
              submitting normally. */}
          <form id="schedule-job-form" onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-0.5 pr-1">
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
                    <Input placeholder="001-0001" {...field} />
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
                  <FormLabel>{t("scheduledDateLabel")}</FormLabel>
                  <FormControl>
                    {/* min only applies going forward for a NEW job — editing
                        an existing job whose date is already today/in the
                        past isn't blocked from opening this input just
                        because of that pre-existing value (see createSchema's
                        own comment on why the validation itself mirrors this
                        same "unchanged is fine" allowance). */}
                    <Input type="date" min={isEdit ? undefined : tomorrowIso()} {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{t("scheduleAtLeastOneDayAheadHelp")}</p>
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
            {/* Hidden entirely for a new job — status is not a choice at
                creation time, it's always 'pending_approval' (see onSubmit's
                own hard-coded override, which holds regardless of whatever
                this field would otherwise contain). Shown only when editing
                an existing job, where changing it directly is still a
                legitimate admin action distinct from the dedicated Approve
                Schedule button below (e.g. cancelling a job, or manually
                reverting an approval). */}
            {isEdit && (
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
            )}
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
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" form="schedule-job-form" variant={showApprove ? "outline" : "default"} disabled={pending}>
            {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : t("scheduleButton")}
          </Button>
          {/* Not type="submit" with form="schedule-job-form" — that would
              trigger the ordinary onSubmit above via native form submission
              instead of this one. form.handleSubmit(onApprove) runs the
              same field validation, then calls onApprove with the
              validated values on success, exactly the same way RHF's own
              <form onSubmit> wiring does. */}
          {showApprove && (
            <Button type="button" onClick={form.handleSubmit(onApprove)} disabled={pending}>
              {pending ? tCommon("saving") : t("approveSchedule")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
