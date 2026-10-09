"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Plus, Printer, ReceiptText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DailyReportDateButton } from "@/components/dashboard/daily-report-date-button"
import { ReleaseSlipSheets, RELEASE_SLIP_CSS, type SlipSignatures } from "@/components/release-slip/release-slip-sheets"
import { AddSlipItemDialog } from "@/components/release-slip/add-slip-item-dialog"
import { fetchReleaseSlip } from "@/lib/api/release-slip"
import { listProducts } from "@/lib/api/inventory"
import { productsKey } from "@/lib/hooks/use-inventory"
import { loadManualItems, manualSlipJob, saveManualItems, type ManualSlipItem } from "@/lib/release-slip-manual"
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
  // Extra parts / errand notes added on this page, kept in this browser per
  // date and technician (see release-slip-manual.ts).
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])
  const manualKey = technicianId ? `${date}:${technicianId}` : null
  const [manual, setManual] = React.useState<{ key: string | null; items: ManualSlipItem[] }>({ key: null, items: [] })
  if (mounted && manual.key !== manualKey) setManual({ key: manualKey, items: technicianId ? loadManualItems(date, technicianId) : [] })
  const setManualItems = (items: ManualSlipItem[]) => {
    if (!technicianId) return
    saveManualItems(date, technicianId, items)
    setManual({ key: manualKey, items })
  }
  const [addOpen, setAddOpen] = React.useState(false)
  // Technicians can't read the product list; they type the item instead.
  const { data: products = [] } = useQuery({ queryKey: productsKey, queryFn: listProducts, enabled: isAdmin })
  const productOptions = React.useMemo(
    () => [...new Set(products.map((p) => (p.sku || p.name).trim()).filter(Boolean))].sort().map((value) => ({ value })),
    [products]
  )
  // For pre-filling a manual row's note: the technician's whole day (pending
  // jobs too — same query as "Include pending jobs"), so a SKU on one of their
  // jobs suggests that job's order and account; otherwise the product itself.
  const { data: wholeDay } = useQuery({
    queryKey: ["releaseSlip", date, technicianId ?? null, true],
    queryFn: () => fetchReleaseSlip(date, technicianId, true),
    enabled: !!user && (!isAdmin || !!pickedTechnician),
  })
  const noteSuggestions = React.useCallback(
    (item: string) => {
      const key = item.trim().toLowerCase()
      if (!key) return []
      const accounts = (wholeDay?.jobs ?? [])
        .filter((j) => j.movements.some((m) => (m.sku || m.label).trim().toLowerCase() === key))
        .map((j) => [j.orderNo, j.accountName].filter(Boolean).join(" — "))
      if (accounts.length) return [...new Set(accounts)]
      const product = products.find((p) => (p.sku || p.name).trim().toLowerCase() === key)
      if (!product) return []
      const sku = (product.sku || "").trim()
      // The name reads "012 / MW) Pre-Carbon": the part after the SKU. (Descriptions
      // carry extra lines like "Location: …", so only their first line is a fallback.)
      const name = product.name.trim()
      const text = (sku && name.startsWith(sku) ? name.slice(sku.length).replace(/^\s*[/-]\s*/, "") : name).trim() || (product.description ?? "").split("\n")[0].trim()
      return [sku && text ? `${sku} - ${text}` : sku || text]
    },
    [wholeDay, products]
  )
  const slipJobs = React.useMemo(() => {
    const extra = manualSlipJob(manual.items)
    return extra ? [...jobs, extra] : jobs
  }, [jobs, manual.items])

  const technicianName = data?.technicianName || (isAdmin ? technicians.find((p) => p.id === pickedTechnician)?.name ?? "" : user?.name ?? "")

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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)} disabled={!technicianId} data-testid="slip-add">
            <Plus className="h-3.5 w-3.5" /> {t("releaseSlipAdd")}
          </Button>
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
          {manual.items.length > 0 && (
            <div className="space-y-1.5 rounded-md border p-3" data-testid="slip-manual-list">
              <p className="text-sm font-medium">{t("releaseSlipManualTitle", { count: String(manual.items.length) })}</p>
              <ul className="space-y-1 text-sm">
                {manual.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2" data-testid="slip-manual-item">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{i.category === "errand" ? t("releaseSlipManualErrand") : t("releaseSlipManualPart")}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {i.item ? `${i.item} · ${i.direction === "out" ? "OUT" : "IN"} ${i.qty}` : ""}
                      {i.item && i.note ? " — " : ""}
                      {i.note}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => setManualItems(manual.items.filter((x) => x.id !== i.id))}
                      aria-label={t("releaseSlipManualRemove")}
                      data-testid="slip-manual-remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* On-screen preview: scrolls sideways on a narrow screen. */}
          <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
            <div className="flex w-max flex-col gap-4">
              <ReleaseSlipSheets date={date} technicianName={technicianName} jobs={slipJobs} signatures={signatures} onSignaturesChange={setSignatures} />
            </div>
          </div>
          {mounted &&
            createPortal(
              <div className="release-slip-print">
                <ReleaseSlipSheets date={date} technicianName={technicianName} jobs={slipJobs} signatures={signatures} />
              </div>,
              document.body
            )}
        </>
      )}
      <AddSlipItemDialog open={addOpen} onOpenChange={setAddOpen} productOptions={productOptions} noteSuggestions={noteSuggestions} onAdd={(item) => setManualItems([...manual.items, item])} />
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
