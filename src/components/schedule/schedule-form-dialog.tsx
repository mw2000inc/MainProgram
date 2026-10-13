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
import { VEHICLE_TYPES } from "@/lib/constants"
import { assignmentAccounts, crewForVehicle, normalizeTechnicianPair, technicianAccountIds } from "@/lib/technicians"
import { requiresSaturdayApproval } from "@/lib/schedule-timeframe"
import { useCreateScheduleJob, useUpdateScheduleJob } from "@/lib/hooks/use-schedule"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCpSystems } from "@/lib/hooks/use-cp-systems"
import { findCustomerByOrderNumber } from "@/lib/customer-lookup"
import { getCpSystemFilterSkus } from "@/lib/filter-parts"
import { useDuplicateJobGuard } from "@/lib/scheduling/use-duplicate-job-guard"
import { toast } from "sonner"
import { useUsers } from "@/lib/hooks/use-misc"
import { JOB_TYPE_LABELS, formatTechnicians } from "@/components/schedule/schedule-columns"
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
    // Trimmed before the required check — typable field (see TechnicianCombobox).
    technician: z.string().trim().min(1, t("selectTechnician")),
    // Transport method for this job — optional, same as most fields here
    // beyond the core job/technician/date. Plain text under the hood (see
    // VEHICLE_TYPES in constants.ts), so this schema never restricts it to
    // just the preset list.
    vehicle: z.string().optional(),
    // Optional second technician — most jobs only need the one above; this is
    // only for jobs that genuinely need two people (e.g. pull-out + install).
    technician2: z.string().trim().optional(),
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

// What "Create Job" on an Unscheduled Visit fills in (the visit's own
// type, order, customer, date, planned technicians, address and details).
export interface ScheduleJobPrefill {
  jobType: ScheduleJobType
  scheduledDate: string
  orderNo?: string
  customerId?: string
  technician?: string
  technician2?: string
  secondaryAddress?: string
  notes?: string
  filterCodes?: string
  vehicle?: string
}

function defaultValues(defaultDate: string, job?: ScheduleJob, prefill?: ScheduleJobPrefill): FormValues {
  if (prefill && !job) {
    return {
      jobType: prefill.jobType,
      technician: prefill.technician ?? "",
      vehicle: prefill.vehicle ?? "",
      technician2: prefill.technician2 || NONE_SENTINEL,
      orderNo: prefill.orderNo ?? "",
      scheduledDate: prefill.scheduledDate,
      scheduledTime: "",
      status: "pending",
      notes: prefill.notes ?? "",
      productId: "",
      quantity: "",
      secondaryAddress: prefill.secondaryAddress ?? "",
      technicianUserId: NONE_SENTINEL,
      technician2UserId: NONE_SENTINEL,
    }
  }
  if (job) {
    return {
      jobType: job.jobType,
      technician: job.technician,
      vehicle: job.vehicle || "",
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
    vehicle: "",
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
  prefill,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDate: string
  // Editing an existing job instead of scheduling a new one.
  job?: ScheduleJob
  // A new job for an existing visit (the Schedule's Unscheduled Visits).
  // The visit was already dispatch-confirmed, so this job starts active
  // ('pending') rather than awaiting a second approval, and its date may be
  // the visit's own date even when that's today.
  prefill?: ScheduleJobPrefill
  onCreated?: (job: ScheduleJob) => void
}) {
  const isEdit = !!job
  const createJob = useCreateScheduleJob()
  const updateJob = useUpdateScheduleJob()
  const { data: products = [] } = useProducts()
  const { data: users = [] } = useUsers()
  const { data: customers = [] } = useCustomers()
  const { data: saleListEntries = [] } = useSaleListEntries()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: cpSystems = [] } = useCpSystems()
  const duplicateWarning = useDuplicateJobGuard()
  // Technician logins, plus the fixed crews' members whatever their role (see assignmentAccounts).
  const technicianAccounts = React.useMemo(() => assignmentAccounts(users), [users])
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")
  const schema = React.useMemo(() => createSchema(t, tCommon, job?.scheduledDate ?? prefill?.scheduledDate), [t, tCommon, job?.scheduledDate, prefill?.scheduledDate])
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(defaultDate, job, prefill),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(defaultDate, job, prefill))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDate, job, prefill])

  // A vehicle with a fixed crew (VEHICLE_CREWS — the Liteace) fills in both
  // technicians and links their logins; they can still be changed after.
  function applyVehicleCrew(vehicle: string) {
    const crew = crewForVehicle(vehicle)
    if (!crew) return
    const ids = technicianAccountIds(crew.primary, crew.secondary, technicianAccounts)
    form.setValue("technician", crew.primary, { shouldDirty: true, shouldValidate: true })
    form.setValue("technician2", crew.secondary, { shouldDirty: true })
    form.setValue("technicianUserId", ids.technicianUserId || NONE_SENTINEL, { shouldDirty: true })
    form.setValue("technician2UserId", ids.technician2UserId || NONE_SENTINEL, { shouldDirty: true })
  }

  const jobType = form.watch("jobType")
  const isFilterChange = jobType === "filter_change"
  const technician2Value = form.watch("technician2")
  const technicianValue = form.watch("technician")
  const hasSecondTechnician = !!technician2Value && technician2Value !== NONE_SENTINEL

  // The account shown in a technician dropdown: the linked login, else the
  // account whose name matches the job's technician name (older jobs and
  // visit suggestions carry only the name).
  const accountByName = (name: string) => technicianAccounts.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase())
  const accountValue = (id: string | undefined, name: string | undefined): string | undefined =>
    id && id !== NONE_SENTINEL ? id : name && name !== NONE_SENTINEL ? accountByName(name)?.id : undefined
  const unlinkedName = (id: string | undefined, name: string | undefined) =>
    !!name && name !== NONE_SENTINEL && !(id && id !== NONE_SENTINEL) && !accountByName(name)
  // Picking an account sets the technician's name and login link together.
  function pickAccount(slot: "primary" | "secondary", id: string) {
    const account = technicianAccounts.find((a) => a.id === id)
    if (slot === "primary") {
      form.setValue("technician", account?.name ?? "", { shouldDirty: true, shouldValidate: true })
      form.setValue("technicianUserId", account?.id ?? NONE_SENTINEL, { shouldDirty: true })
    } else {
      form.setValue("technician2", account?.name ?? NONE_SENTINEL, { shouldDirty: true })
      form.setValue("technician2UserId", account?.id ?? NONE_SENTINEL, { shouldDirty: true })
    }
  }
  // The login links saved with the job: the picked accounts, else matched by name.
  function linkedIds(values: FormValues) {
    const pair = technicianPairOf(values)
    const byName = technicianAccountIds(pair.primary, pair.secondary, technicianAccounts)
    const pick = (v: string | undefined) => (v && v !== NONE_SENTINEL ? v : "")
    return {
      technicianUserId: pick(values.technicianUserId) || byName.technicianUserId || "",
      technician2UserId: pair.secondary ? pick(values.technician2UserId) || byName.technician2UserId || "" : "",
    }
  }

  // The job's technician pair after the shared rules (see lib/technicians.ts);
  // this form stores "no second technician" as NONE_SENTINEL.
  function technicianPairOf(values: FormValues) {
    return normalizeTechnicianPair(values.technician, values.technician2 === NONE_SENTINEL ? "" : values.technician2)
  }

  // One open job per Order No. and job type (findOpenJobForOrder): a new job,
  // or an edit that changes its type or Order No., is refused when the order
  // already has an approved or draft job of that type — shown on the Order
  // No. field and as a toast. True when it's fine to save.
  async function passesDuplicateCheck(values: FormValues): Promise<boolean> {
    const changed = !isEdit || values.jobType !== job.jobType || (values.orderNo ?? "").trim() !== (job.orderNo ?? "").trim()
    if (!changed) return true
    const duplicate = await duplicateWarning(values.jobType, values.orderNo, job?.id)
    if (!duplicate) return true
    form.setError("orderNo", { type: "duplicate", message: duplicate })
    toast.warning(duplicate)
    return false
  }

  async function onSubmit(values: FormValues) {
    if (!(await passesDuplicateCheck(values))) return
    const input = {
      ...values,
      // Same "" (not undefined) reasoning as technicianUserId below — the
      // form's own defaultValues always sets this to a real string, but the
      // schema itself leaves it optional (it's genuinely fine to submit
      // blank), so this coerces the type back to what ScheduleJob expects
      // without changing any actual runtime value.
      vehicle: values.vehicle ?? "",
      // The pair after the shared rules (no second without a real first, never the same
      // person twice). "" — not undefined — for "no second technician": toRow only writes
      // technician_2 when it isn't undefined, so undefined here meant removing a second
      // technician on an edit never actually cleared it (same reason technicianUserId
      // below is "" rather than undefined).
      technician: technicianPairOf(values).primary,
      technician2: technicianPairOf(values).secondary,
      // "" (not undefined) so toRow's `!== undefined` check still fires and
      // actually clears technician_user_id in the DB when an edit sets this
      // back to "None" — undefined here would make toRow skip the field
      // entirely, silently leaving a stale link in place.
      ...linkedIds(values),
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
      // A visit's job (prefill) starts active — unless it's for a Saturday,
      // whose coverage an admin confirms first.
      status: isEdit ? values.status : prefill && !requiresSaturdayApproval(values.scheduledDate) ? "pending" : "pending_approval",
    }
    if (isEdit) {
      await updateJob.mutateAsync({ id: job.id, input })
    } else {
      // Not form fields — carried over from the visit being scheduled.
      const link = prefill ? {} : memberLinkFor(values)
      const created = await createJob.mutateAsync({ ...input, customerId: prefill?.customerId ?? link.customerId, filterCodes: prefill?.filterCodes ?? link.filterCodes })
      onCreated?.(created)
    }
    onOpenChange(false)
  }

  // A hand-made job (Schedule Job) carries its member, found by Order No.
  // through the Sale List like every Add form — so approving it gives the new
  // or linked record the member's Account Name, Address and Contact Number
  // (ensure_schedule_job_module_record) and every Schedule view can show
  // them. A Filter Change job also carries the order's filters: those of its
  // own upcoming Filter Change (the record approval links it to — never
  // overwritten with something else), else its CP System's filters (as the
  // Filter Change Add form suggests). An unknown Order No. carries nothing.
  function memberLinkFor(values: FormValues): { customerId?: string; filterCodes?: string } {
    const orderNo = (values.orderNo ?? "").trim()
    if (!orderNo) return {}
    const customerId = findCustomerByOrderNumber(customers, saleListEntries, orderNo)?.id
    if (values.jobType !== "filter_change") return { customerId }
    const days = (d: string) => Math.abs(new Date(d).getTime() - new Date(values.scheduledDate).getTime()) / 86_400_000
    const upcoming = filterChangePlans
      .filter((p) => p.status === "Pending" && !p.scheduleJobId && p.orderNumber.trim() === orderNo && days(p.preD || p.planDate) <= 60)
      .sort((a, b) => days(a.preD || a.planDate) - days(b.preD || b.planDate))[0]
    if (upcoming) return { customerId, filterCodes: upcoming.filterType.trim() || undefined }
    const sale = saleListEntries.find((e) => e.orderNumber.trim() === orderNo)
    const system = sale?.cpSystemId ? cpSystems.find((c) => c.id === sale.cpSystemId) : undefined
    const skus = system ? getCpSystemFilterSkus(system, products) : []
    return { customerId, filterCodes: skus.join(", ") || undefined }
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
    if (!(await passesDuplicateCheck(values))) return
    const input = {
      ...values,
      // Same "" (not undefined) reasoning as technicianUserId below — the
      // form's own defaultValues always sets this to a real string, but the
      // schema itself leaves it optional (it's genuinely fine to submit
      // blank), so this coerces the type back to what ScheduleJob expects
      // without changing any actual runtime value.
      vehicle: values.vehicle ?? "",
      // The pair after the shared rules (no second without a real first, never the same
      // person twice). "" — not undefined — for "no second technician": toRow only writes
      // technician_2 when it isn't undefined, so undefined here meant removing a second
      // technician on an edit never actually cleared it (same reason technicianUserId
      // below is "" rather than undefined).
      technician: technicianPairOf(values).primary,
      technician2: technicianPairOf(values).secondary,
      ...linkedIds(values),
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
              name="technicianUserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("technician")}</FormLabel>
                  {/* One field: picking a technician's account sets both the
                      name shown/printed on the job and the login link that puts
                      the job on their own Daily Report and Schedule. */}
                  <Select value={accountValue(field.value, technicianValue)} onValueChange={(id) => pickAccount("primary", id)}>
                    <FormControl>
                      <SelectTrigger className="w-full" data-testid="schedule-form-technician">
                        <SelectValue placeholder={t("selectTechnician")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {technicianAccounts.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* A job saved earlier under a name with no login (or typed
                      by hand) keeps that name until someone picks an account. */}
                  {unlinkedName(field.value, technicianValue) && (
                    <p className="text-xs text-muted-foreground">{t("technicianNoAccount", { name: technicianValue })}</p>
                  )}
                  {form.formState.errors.technician && (
                    <p className="text-destructive text-sm">{form.formState.errors.technician.message}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="technician2UserId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("secondTechnicianOptional")}</FormLabel>
                  <Select
                    value={hasSecondTechnician ? accountValue(field.value, technician2Value) : NONE_SENTINEL}
                    onValueChange={(id) => pickAccount("secondary", id)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full" data-testid="schedule-form-technician2">
                        <SelectValue placeholder={t("addSecondTechnicianPlaceholder")} />
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
                  {hasSecondTechnician && unlinkedName(field.value, technician2Value) && (
                    <p className="text-xs text-muted-foreground">{t("technicianNoAccount", { name: technician2Value })}</p>
                  )}
                  {/* One shared job: both technicians are on the same date. */}
                  {hasSecondTechnician && <p className="text-xs text-muted-foreground">{t("sharesSameDateNote")}</p>}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vehicle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("vehicleOptional")}</FormLabel>
                  <Select
                    value={field.value || NONE_SENTINEL}
                    onValueChange={(v) => {
                      const vehicle = v === NONE_SENTINEL ? "" : v
                      field.onChange(vehicle)
                      applyVehicleCrew(vehicle)
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectVehicle")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>{tCommon("none")}</SelectItem>
                      {VEHICLE_TYPES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                      {/* A value already on the record that isn't one of the
                          known presets (e.g. a specific plate typed in some
                          other way) still gets its own option — same
                          pattern the Technician Select in
                          approval-detail-dialog.tsx already uses for an
                          unlisted roster name, so an existing custom value
                          is never silently hidden. */}
                      {field.value && !(VEHICLE_TYPES as readonly string[]).includes(field.value) && (
                        <SelectItem value={field.value}>{field.value}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  {crewForVehicle(field.value) && (
                    <p className="text-xs text-muted-foreground">
                      {t("vehicleCrewNote", {
                        vehicle: field.value ?? "",
                        crew: formatTechnicians(crewForVehicle(field.value)!.primary, crewForVehicle(field.value)!.secondary, t("and")),
                      })}
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
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
