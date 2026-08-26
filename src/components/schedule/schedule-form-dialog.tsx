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
import type { ScheduleJob, ScheduleJobStatus, ScheduleJobType } from "@/lib/types"

const JOB_TYPES = Object.keys(JOB_TYPE_LABELS) as ScheduleJobType[]
const STATUSES: ScheduleJobStatus[] = ["pending", "completed", "cancelled"]
const STATUS_LABELS: Record<ScheduleJobStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
}

// Radix Select forbids an empty-string item value, so "none selected" needs
// its own sentinel — mapped back to "" (unset) on submit. Shared by every
// optional Select on this form (second technician, linked technician
// account).
const NONE_SENTINEL = "__none__"

const schema = z.object({
  jobType: z.custom<ScheduleJobType>((v) => typeof v === "string" && v.length > 0, "Select a job type"),
  technician: z.string().min(1, "Select a technician"),
  // Optional second technician — most jobs only need the one above; this is
  // only for jobs that genuinely need two people (e.g. pull-out + install).
  technician2: z.string().optional(),
  orderNo: z.string().optional(),
  scheduledDate: z.string().min(1, "Date is required"),
  // Free text ("ANYTIME", "MORNING", "2:00 PM") — see ScheduleJob.scheduledTime.
  scheduledTime: z.string().optional(),
  status: z.custom<ScheduleJobStatus>((v) => typeof v === "string" && v.length > 0, "Select a status"),
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

type FormValues = z.infer<typeof schema>

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
          <DialogTitle>{isEdit ? "Edit Job" : "Schedule a Job"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this scheduled job." : "Add a technician job to the daily agenda."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="jobType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Job Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select job type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {JOB_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {JOB_TYPE_LABELS[t]}
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
                  <FormLabel>Technician</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select technician" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TECHNICIANS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
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
                  <FormLabel>Second Technician (Optional)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Add a second technician if this job needs two" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                      {TECHNICIANS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* There's deliberately no separate date field for the second
                      technician — the Date field below applies to this one
                      shared job, so both technicians are always on it together. */}
                  {field.value && field.value !== NONE_SENTINEL && (
                    <p className="text-xs text-muted-foreground">
                      Shares the same date, order, and status as the primary technician below — this is one job, not two.
                    </p>
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
                  <FormLabel>Technician Account (Optional)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Link to a technician's login" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE_SENTINEL}>None</SelectItem>
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
                  <p className="text-xs text-muted-foreground">
                    Lets this technician see the job on their own Schedule. Unrelated to the Technician field above.
                  </p>
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
                    <FormLabel>Technician 2 Account (Optional)</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Link to the second technician's login" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE_SENTINEL}>None</SelectItem>
                        {technicianAccounts.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Lets the second technician also see this shared job on their own Schedule.
                    </p>
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
                  <FormLabel>Order No (Optional)</FormLabel>
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
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  {hasSecondTechnician && (
                    <p className="text-xs text-muted-foreground">
                      Both {technicianValue || "the first technician"} and {technician2Value} are scheduled for this
                      date — there&apos;s a single Date field for the whole job, so changing it moves both.
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
                  <FormLabel>Time (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. ANYTIME, MORNING, 2:00 PM" {...field} />
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
                  <FormLabel>Secondary Address (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. pull-out address, if different from the install address" {...field} />
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
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
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
                      <FormLabel>Filter to Deduct (Optional)</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select inventory item" />
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
                      <FormLabel>Quantity to Deduct</FormLabel>
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
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Optional notes..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Schedule"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
