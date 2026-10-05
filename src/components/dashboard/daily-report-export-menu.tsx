"use client"

import * as React from "react"
import { Download, FileSpreadsheet, FileText, FileType } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatTechnicians, JOB_TYPE_LABELS } from "@/components/schedule/schedule-columns"
import { useScheduleJobs } from "@/lib/hooks/use-schedule"
import { useCustomers } from "@/lib/hooks/use-customers"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { exportToCsv } from "@/lib/export/csv"
import { exportWorkbook } from "@/lib/export/excel"
import { exportToPdf } from "@/lib/export/pdf"
import { isAssignedTechnician } from "@/lib/technicians"
import { formatDate } from "@/lib/utils"
import type { StockMovementRow } from "@/lib/hooks/use-inventory"
import type { CollectionPlan, FilterChangePlan, InstallPlan, RepairPlan, ScheduleJob } from "@/lib/types"

// Every exported row has the same columns, whichever section it's from.
const COLUMNS = ["Section", "Date", "Technician", "Vehicle", "Order No", "Customer", "Status", "Details", "Notes"] as const
type ExportRow = Record<(typeof COLUMNS)[number], string>

const techs = (a: string | undefined, b?: string) => (isAssignedTechnician(a) ? formatTechnicians(a!, b || undefined, "&") : "Unassigned")
const joined = (...parts: (string | number | undefined | null)[]) => parts.filter((p) => p !== undefined && p !== null && String(p).trim() !== "").join(" · ")

// "Download Report" on the Daily Report toolbar: everything the report shows
// for the selected date — Schedule jobs, Filter Changes, Installations,
// Repairs, Collections and Inventory movements — as one Excel workbook (a
// Summary sheet plus a sheet per section), one CSV, or one PDF, each row with
// date, technician, vehicle, order number, customer, status and notes.
// Technicians get the same view they see (RLS already limits their data).
export function DailyReportExportMenu({
  reportDate,
  filterChanges,
  installs,
  repairs,
  collections,
  stockMovements,
}: {
  reportDate: string
  filterChanges: FilterChangePlan[]
  installs: InstallPlan[]
  repairs: RepairPlan[]
  collections: CollectionPlan[]
  stockMovements: StockMovementRow[]
}) {
  const { t } = useTranslation("dispatch")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const { data: jobs = [] } = useScheduleJobs()
  const { data: customers = [] } = useCustomers()

  const sections = React.useMemo(() => {
    const customerById = new Map(customers.map((c) => [c.id, c]))
    const jobById = new Map(jobs.map((j) => [j.id, j]))
    const customerName = (id?: string) => {
      const c = id ? customerById.get(id) : undefined
      return c ? c.companyName || c.fullName : ""
    }
    const vehicleOf = (scheduleJobId?: string) => (scheduleJobId ? (jobById.get(scheduleJobId)?.vehicle ?? "") : "")
    // Same jobs the Schedule widget lists for the day: not ones still
    // awaiting approval (except, for admins, drafts / Saturday jobs — shown
    // there for review) and, for a technician, only their own.
    const dayJobs = jobs.filter(
      (j: ScheduleJob) =>
        j.scheduledDate === reportDate &&
        (j.status !== "pending_approval" || isAdmin) &&
        (isAdmin || j.technicianUserId === user?.id || j.technician2UserId === user?.id)
    )

    const schedule: ExportRow[] = dayJobs.map((j) => ({
      Section: "Schedule",
      Date: j.scheduledDate,
      Technician: techs(j.technician, j.technician2),
      Vehicle: j.vehicle ?? "",
      "Order No": j.orderNo ?? "",
      Customer: customerName(j.customerId),
      Status: j.status === "pending_approval" ? "Pending approval" : j.status.charAt(0).toUpperCase() + j.status.slice(1),
      Details: joined(JOB_TYPE_LABELS[j.jobType], j.scheduledTime, j.filterCodes && `Filters ${j.filterCodes}`),
      Notes: joined(j.notes, j.remarks && `Remarks: ${j.remarks}`),
    }))
    const filter: ExportRow[] = filterChanges.map((p) => ({
      Section: "Filter Change",
      Date: p.preD || p.planDate,
      Technician: techs(p.serviceman, p.serviceman2),
      Vehicle: vehicleOf(p.scheduleJobId),
      "Order No": p.orderNumber,
      Customer: p.memberAccount || customerName(p.customerId),
      Status: p.status,
      Details: joined(p.filterType && `Filters ${p.filterType}`, p.accD && `Done ${p.accD}`),
      Notes: p.note ?? "",
    }))
    const install: ExportRow[] = installs.map((p) => ({
      Section: "Installation",
      Date: p.preInstalledDate || p.inputDate,
      Technician: techs(p.serviceman, p.serviceman2),
      Vehicle: vehicleOf(p.scheduleJobId),
      "Order No": p.orderNo,
      Customer: p.name,
      Status: p.status,
      Details: joined(p.model && `Model ${p.model}`, p.installedDate && `Installed ${p.installedDate}`),
      Notes: p.note ?? "",
    }))
    const repair: ExportRow[] = repairs.map((p) => ({
      Section: "Repair",
      Date: p.preD || p.issuedDate,
      Technician: techs(p.th, p.th2),
      Vehicle: vehicleOf(p.scheduleJobId),
      "Order No": p.orderNo,
      Customer: p.accountName,
      Status: p.status,
      Details: joined(p.problem && `Issue: ${p.problem}`, p.solutionStatus && `Solution: ${p.solutionStatus}`, p.partNo && `Parts: ${p.partNo}`),
      Notes: p.note ?? "",
    }))
    const collection: ExportRow[] = collections.map((p) => ({
      Section: "Collection",
      Date: p.preD || p.collectionDate,
      Technician: techs(p.serviceman, p.serviceman2),
      Vehicle: vehicleOf(p.scheduleJobId),
      "Order No": p.orderNo,
      Customer: p.accountName || customerName(p.customerId),
      Status: p.status,
      Details: joined(p.ct && `C/T ${p.ct}`, p.amount ? `Amount ₱${p.amount.toLocaleString()}` : ""),
      Notes: p.note ?? "",
    }))
    const inventory: ExportRow[] = stockMovements.map((m) => ({
      Section: "Inventory",
      Date: m.date,
      Technician: m.userName ?? "",
      Vehicle: "",
      "Order No": m.relatedJobOrderNo || m.referenceNumber || "",
      Customer: m.relatedCustomerName ?? "",
      Status: m.status ? m.status.charAt(0).toUpperCase() + m.status.slice(1) : "Approved",
      Details: joined(m.productName, m.quantityRemoved ? `-${m.quantityRemoved}` : `+${m.quantityAdded}`, m.reason),
      Notes: joined(m.approvedByName && `Approved by ${m.approvedByName}`, m.rejectedByName && `Rejected by ${m.rejectedByName}`),
    }))
    return [
      { name: "Schedule Jobs", rows: schedule },
      { name: "Filter Changes", rows: filter },
      { name: "Installations", rows: install },
      { name: "Repairs", rows: repair },
      { name: "Collections", rows: collection },
      { name: "Inventory", rows: inventory },
    ]
  }, [jobs, customers, filterChanges, installs, repairs, collections, stockMovements, reportDate, isAdmin, user?.id])

  const fileName = `daily-report-${reportDate}`
  const allRows = sections.flatMap((s) => s.rows)
  const done = (s: string) => /^(completed|collected|approved)$/i.test(s)

  const downloadExcel = () => {
    const summary = [
      { Item: "Report date", Value: formatDate(reportDate) },
      ...sections.map((s) => ({ Item: s.name, Value: `${s.rows.length} (${s.rows.filter((r) => done(r.Status)).length} done)` })),
      { Item: "Collections total", Value: `₱${collections.reduce((n, c) => n + (c.amount || 0), 0).toLocaleString()}` },
      { Item: "Generated", Value: new Date().toLocaleString() },
    ]
    exportWorkbook([{ name: "Summary", rows: summary, headers: ["Item", "Value"] }, ...sections.map((s) => ({ ...s, headers: [...COLUMNS] }))], fileName)
    toast.success(t("reportDownloaded", { count: allRows.length }))
  }
  const downloadCsv = () => {
    exportToCsv(allRows.length ? allRows : [Object.fromEntries(COLUMNS.map((c) => [c, ""]))], fileName)
    toast.success(t("reportDownloaded", { count: allRows.length }))
  }
  const downloadPdf = () => {
    exportToPdf({
      title: `Daily Report — ${formatDate(reportDate)}`,
      subtitle: sections.map((s) => `${s.name}: ${s.rows.length}`).join("  ·  "),
      columns: COLUMNS.map((c) => ({ header: c, key: c })),
      // The PDF's built-in font has no ₱ glyph.
      rows: allRows.map((r) => ({ ...r, Details: r.Details.replace(/₱/g, "PHP ") })),
      fileName,
    })
    toast.success(t("reportDownloaded", { count: allRows.length }))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" data-testid="daily-report-download">
          <Download className="h-3.5 w-3.5" /> {t("downloadReport")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t("downloadReportFor", { date: formatDate(reportDate), count: allRows.length })}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={downloadExcel} data-testid="daily-report-download-excel">
          <FileSpreadsheet className="h-4 w-4 text-success" /> {t("downloadExcel")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadCsv} data-testid="daily-report-download-csv">
          <FileType className="h-4 w-4 text-primary" /> {t("downloadCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadPdf} data-testid="daily-report-download-pdf">
          <FileText className="h-4 w-4 text-destructive" /> {t("downloadPdf")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
