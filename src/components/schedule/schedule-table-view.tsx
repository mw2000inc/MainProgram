"use client"

import * as React from "react"
import { Printer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTechnicians, matchesTechnician } from "@/components/schedule/schedule-columns"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { printScheduleTable, type ScheduleTableRow } from "@/lib/export/print"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatCurrency, formatDate } from "@/lib/utils"
import { TECHNICIANS } from "@/lib/constants"
import type { ScheduleJob, Customer, FilterChangePlan, CollectionPlan, SaleListEntry } from "@/lib/types"

// Picks the best soft-match among same-order-number candidates from a
// sibling table (filter_change_plans/collections/sale_list_entries — none
// of which have a real FK to schedule_jobs, only a shared order number) —
// prefer one that also falls on the same date as the job, otherwise the
// most recent by that table's own date field. Never errors on 0 or several
// matches, per the agreed design.
function pickBestMatch<T>(items: T[], dateOf: (item: T) => string | undefined, preferredDate: string): T | undefined {
  if (items.length === 0) return undefined
  const sameDate = items.find((i) => dateOf(i) === preferredDate)
  if (sameDate) return sameDate
  return [...items].sort((a, b) => (dateOf(b) ?? "").localeCompare(dateOf(a) ?? ""))[0]
}

function resolveRows(
  dayJobs: ScheduleJob[],
  customers: Customer[],
  filterChangePlans: FilterChangePlan[],
  collections: CollectionPlan[],
  saleListEntries: SaleListEntry[]
): ScheduleTableRow[] {
  return dayJobs.map((job) => {
    const customer = job.customerId ? customers.find((c) => c.id === job.customerId) : undefined

    const filterChangeMatch = job.orderNo
      ? pickBestMatch(
          filterChangePlans.filter((p) => p.orderNumber === job.orderNo),
          (p) => p.planDate,
          job.scheduledDate
        )
      : undefined
    const collectionMatch = job.orderNo
      ? pickBestMatch(
          collections.filter((c) => c.orderNo === job.orderNo),
          (c) => c.collectionDate,
          job.scheduledDate
        )
      : undefined
    const saleListMatch = job.orderNo
      ? pickBestMatch(
          saleListEntries.filter((e) => e.orderNumber === job.orderNo),
          (e) => e.createdAt,
          job.scheduledDate
        )
      : undefined

    return {
      time: job.scheduledTime ?? "",
      contactPerson: customer?.fullName ?? "",
      contactNo: customer?.contactNumber ?? "",
      orderNumber: job.orderNo ?? "",
      memberAcctName: customer ? customer.companyName || customer.fullName : "",
      address: customer?.address ?? "",
      itemOut: filterChangeMatch?.filterType ?? "",
      technician: formatTechnicians(job.technician, job.technician2),
      collection: collectionMatch ? formatCurrency(collectionMatch.amount) : "",
      description: job.notes ?? "",
      unitModel: saleListMatch?.productNo ?? "",
      secondaryAddress: job.secondaryAddress,
    }
  })
}

// The Schedule page's "Table View" — a dated daily table replicating the old
// AppSheet reference layout (one printable sheet per day), built by
// soft-matching schedule_jobs against customers (via customer_id) and
// filter_change_plans/collections/sale_list_entries (by order number, since
// none of those have a real FK to schedule_jobs — see the investigation this
// was scoped from). A job's secondaryAddress (pull-out vs install address)
// renders as an extra row right below it, spanning every other column.
export function ScheduleTableView({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const { t } = useTranslation("schedule")
  const { t: tCommon } = useTranslation("common")
  const { data: jobs = [], isPending: p1 } = useScheduleJobs()
  const { data: customers = [], isPending: p2 } = useCustomers()
  const { data: filterChangePlans = [], isPending: p3 } = useFilterChangePlans()
  const { data: collections = [], isPending: p4 } = useCollections()
  const { data: saleListEntries = [], isPending: p5 } = useSaleListEntries()
  const isPending = p1 || p2 || p3 || p4 || p5

  // Same "All" + roster filter as the Schedule page's own List view (see
  // matchesTechnician's own comment on why the match itself is shared) —
  // its own independent state, not synced with the List view's filter,
  // same as this view's date isn't either. Defaults to "all", matching
  // today's unfiltered behavior. Options come from the TECHNICIANS roster,
  // not the jobs actually on record — a name stays choosable even on a day
  // with nothing assigned to them yet, matching the List view.
  const [technicianFilter, setTechnicianFilter] = React.useState<string>("all")

  const dayJobs = React.useMemo(() => jobs.filter((j) => j.scheduledDate === date), [jobs, date])
  const scopedDayJobs = React.useMemo(
    () => (technicianFilter === "all" ? dayJobs : dayJobs.filter((j) => matchesTechnician(j, technicianFilter))),
    [dayJobs, technicianFilter]
  )
  // Printing reflects whatever's currently filtered on screen, same as
  // every other page's export/print already does.
  const rows = React.useMemo(
    () => resolveRows(scopedDayJobs, customers, filterChangePlans, collections, saleListEntries),
    [scopedDayJobs, customers, filterChangePlans, collections, saleListEntries]
  )

  const dateHeading = formatDate(date, "MMMM d, yyyy — EEEE")

  function handlePrint() {
    printScheduleTable({ title: "Schedule", subtitle: dateHeading, rows })
  }

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="table-view-date" className="text-xs text-muted-foreground">
                {t("date")}
              </Label>
              <Input
                id="table-view-date"
                type="date"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="w-full max-w-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("technician")}</Label>
              <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue placeholder={t("allTechnicians")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTechnicians")}</SelectItem>
                  {TECHNICIANS.map((tech) => (
                    <SelectItem key={tech} value={tech}>
                      {tech}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> {tCommon("print")}
          </Button>
        </div>

        <h2 className="text-lg font-semibold">{dateHeading}</h2>

        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">{t("noJobsScheduled")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                {/* This table replicates a printable AppSheet reference sheet
                    (see printScheduleTable) — its column headers stay in
                    English regardless of interface language, same as every
                    other module's print/export column arrays (deferred to
                    the long-tail i18n phase). */}
                <tr className="bg-muted/50">
                  {[
                    "Time",
                    "Contact Person",
                    "Contact No.",
                    "Order Number",
                    "Member Acct. Name",
                    "Address",
                    "Item-OUT",
                    "Assigned Technician",
                    "Collection",
                    "Description",
                    "Unit Model",
                  ].map((h) => (
                    <th key={h} className="border px-2.5 py-2 text-left text-xs font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <React.Fragment key={i}>
                    <tr>
                      <td className="border px-2.5 py-2 whitespace-nowrap">{row.time || "—"}</td>
                      <td className="border px-2.5 py-2">{row.contactPerson || "—"}</td>
                      <td className="border px-2.5 py-2 whitespace-nowrap">{row.contactNo || "—"}</td>
                      <td className="border px-2.5 py-2 whitespace-nowrap">{row.orderNumber || "—"}</td>
                      <td className="border px-2.5 py-2">{row.memberAcctName || "—"}</td>
                      <td className="border px-2.5 py-2">{row.address || "—"}</td>
                      <td className="border px-2.5 py-2">{row.itemOut || "—"}</td>
                      <td className="border px-2.5 py-2 whitespace-nowrap">{row.technician || "—"}</td>
                      <td className="border px-2.5 py-2 whitespace-nowrap">{row.collection || "—"}</td>
                      <td className="border px-2.5 py-2">{row.description || "—"}</td>
                      <td className="border px-2.5 py-2">{row.unitModel || "—"}</td>
                    </tr>
                    {row.secondaryAddress && (
                      <tr className="bg-muted/30">
                        <td className="border px-2.5 py-2" colSpan={5} />
                        <td className="border px-2.5 py-2 italic text-muted-foreground">{row.secondaryAddress}</td>
                        <td className="border px-2.5 py-2" colSpan={5} />
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
