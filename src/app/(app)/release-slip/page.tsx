"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Printer, ReceiptText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DailyReportDateButton } from "@/components/dashboard/daily-report-date-button"
import { ReleaseSlipSheets, RELEASE_SLIP_CSS, type SlipSignatures } from "@/components/release-slip/release-slip-sheets"
import { fetchReleaseSlip } from "@/lib/api/release-slip"
import { useAuth } from "@/lib/auth/auth-context"
import { useUsers } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { businessToday } from "@/lib/dispatch-lead-time"
import { assignmentAccounts } from "@/lib/technicians"

// A ?date= value: YYYY-MM-DD and a real calendar date, else today (Manila).
function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : undefined
}

// Printing shows only the slip: the sheets are also rendered into a portal on
// <body> (print-only), and everything else on the page is hidden for print.
const PRINT_CSS = `
.release-slip-print { display: none; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background: #fff !important; }
  body > *:not(.release-slip-print) { display: none !important; }
  .release-slip-print { display: block !important; }
  .release-slip-print .slip-page { break-after: page; page-break-after: always; }
  .release-slip-print .slip-page:last-child { break-after: auto; page-break-after: auto; }
}
`

function ReleaseSlipContent() {
  const { t } = useTranslation("schedule")
  const { t: tNav } = useTranslation("nav")
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const searchParams = useSearchParams()
  const date = validDate(searchParams.get("date")) ?? businessToday()
  const setDate = (next: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set("date", next)
    window.history.replaceState(null, "", `?${params.toString()}`)
  }
  const [includePending, setIncludePending] = React.useState(false)
  const { data: users = [] } = useUsers()
  const technicians = React.useMemo(() => assignmentAccounts(users).sort((a, b) => a.name.localeCompare(b.name)), [users])
  // A technician always gets their own slip (the database decides); an admin
  // picks whose slip to print.
  const [pickedTechnician, setPickedTechnician] = React.useState<string | undefined>(undefined)
  const technicianId = isAdmin ? pickedTechnician : user?.id
  const [signatures, setSignatures] = React.useState<SlipSignatures>({ checkedBy: "Jerson", notedBy: "Jan", approvedBy: "Malou" })

  const { data, isPending, error } = useQuery({
    queryKey: ["releaseSlip", date, technicianId ?? null, includePending],
    queryFn: () => fetchReleaseSlip(date, technicianId, includePending),
    enabled: !!user && (!isAdmin || !!pickedTechnician),
  })
  // Pending jobs print with blank OUT lines.
  const jobs = React.useMemo(
    () => (data?.jobs ?? []).map((j) => (j.status === "completed" ? j : { ...j, movements: [] })),
    [data]
  )
  const technicianName = data?.technicianName || (isAdmin ? technicians.find((p) => p.id === pickedTechnician)?.name ?? "" : user?.name ?? "")

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  const ready = !!data && !isPending
  return (
    <div className="space-y-4">
      <style>{RELEASE_SLIP_CSS + PRINT_CSS}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ReceiptText className="h-6 w-6 text-primary" /> {tNav("releaseSlip")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("releaseSlipDescription")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DailyReportDateButton value={date} onChange={setDate} />
          {isAdmin && (
            <Select value={pickedTechnician ?? ""} onValueChange={setPickedTechnician}>
              <SelectTrigger className="h-8 w-52" data-testid="slip-technician">
                <SelectValue placeholder={t("releaseSlipPickTechnician")} />
              </SelectTrigger>
              <SelectContent>
                {technicians.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={includePending} onCheckedChange={(v) => setIncludePending(v === true)} data-testid="slip-include-pending" />
            {t("releaseSlipIncludePending")}
          </label>
          <Button size="sm" className="gap-1.5" onClick={() => window.print()} disabled={!ready} data-testid="slip-print">
            <Printer className="h-3.5 w-3.5" /> {t("print")}
          </Button>
        </div>
      </div>

      {isAdmin && !pickedTechnician ? (
        <p className="text-sm text-muted-foreground">{t("releaseSlipPickTechnicianHint")}</p>
      ) : error ? (
        <p className="text-sm text-danger" data-testid="slip-error">
          {t("releaseSlipError")}
        </p>
      ) : !ready ? (
        <Skeleton className="h-[600px] w-[210mm] max-w-full" />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="slip-count">
            {t("releaseSlipCount", { count: String(jobs.length) })}
          </p>
          {/* On-screen preview: scrolls sideways on a narrow screen. */}
          <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="flex w-max flex-col gap-4">
              <ReleaseSlipSheets date={date} technicianName={technicianName} jobs={jobs} signatures={signatures} onSignaturesChange={setSignatures} />
            </div>
          </div>
          {mounted &&
            createPortal(
              <div className="release-slip-print">
                <ReleaseSlipSheets date={date} technicianName={technicianName} jobs={jobs} signatures={signatures} />
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  )
}

export default function ReleaseSlipPage() {
  return (
    <React.Suspense fallback={null}>
      <ReleaseSlipContent />
    </React.Suspense>
  )
}
