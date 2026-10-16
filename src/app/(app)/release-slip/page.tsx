"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Download, Plus, Printer, ReceiptText, RotateCcw, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DailyReportDateButton } from "@/components/dashboard/daily-report-date-button"
import {
  applySlipEdits,
  blankSlipJob,
  ReleaseSlipSheets,
  RELEASE_SLIP_CSS,
  type SlipEdits,
  type SlipJobEdit,
  type SlipSignatures,
} from "@/components/release-slip/release-slip-sheets"
import { AddSlipItemDialog } from "@/components/release-slip/add-slip-item-dialog"
import { fetchReleaseSlip } from "@/lib/api/release-slip"
import { listProducts } from "@/lib/api/inventory"
import { productsKey } from "@/lib/hooks/use-inventory"
import { loadManualItems, manualSlipJob, saveManualItems, type ManualSlipItem } from "@/lib/release-slip-manual"
import { collectionNoteFor } from "@/lib/release-slip-collect"
import { useCollections } from "@/lib/hooks/use-collections"
import { useSaleListEntries } from "@/lib/hooks/use-sale-list"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { repairPartLines } from "@/lib/release-slip-repair-parts"
import { useAuth } from "@/lib/auth/auth-context"
import { useUsers } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { businessToday } from "@/lib/dispatch-lead-time"
import { assignmentAccounts, isAssignedTechnician } from "@/lib/technicians"
import type { ReleaseSlipJob } from "@/lib/api/release-slip"

// The admin's technician picker value for every technician's slip at once.
const ALL_TECHNICIANS = "all"

// A ?date= value: YYYY-MM-DD and a real calendar date, else today (Manila).
function validDate(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : undefined
}

// Printing shows only the slip: the sheets are also rendered into a portal on
// <body> (print-only), and everything else on the page is hidden for print.
// Prints with a temporary page title — the file name the browser suggests
// for "Save as PDF".
function printAs(title: string) {
  const previous = document.title
  document.title = title
  window.print()
  document.title = previous
}

const DEFAULT_SIGNATURES: SlipSignatures = { checkedBy: "Jerson", notedBy: "Jan", approvedBy: "Malou" }

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
  // picks whose slip to print, or every technician's ("All technicians", the
  // default) — then the day's jobs come in one call and are split per
  // technician below.
  const [pickedTechnician, setPickedTechnician] = React.useState<string>(ALL_TECHNICIANS)
  const allMode = isAdmin && pickedTechnician === ALL_TECHNICIANS
  const technicianId = isAdmin ? (allMode ? undefined : pickedTechnician) : user?.id
  const [signatures, setSignatures] = React.useState<SlipSignatures>(DEFAULT_SIGNATURES)
  // An admin's on-screen edits (see applySlipEdits): per slip, then per job —
  // for this date / technician / pending choice only; changing any of them,
  // or "Reset Edits", starts again from the database values.
  const editsKey = `${date}|${technicianId ?? "all"}|${includePending}`
  // added: the blank order rows added per slip ("+ Add Order No."), by id.
  const [editState, setEditState] = React.useState<{ key: string; edits: Record<string, SlipEdits>; added: Record<string, string[]> }>({
    key: editsKey,
    edits: {},
    added: {},
  })
  if (editState.key !== editsKey) setEditState({ key: editsKey, edits: {}, added: {} })
  const edits = editState.edits
  const added = editState.added
  const hasEdits = Object.keys(edits).length > 0 || Object.values(added).some((ids) => ids.length > 0)
  const addOrderRow = (slipKey: string) =>
    setEditState((s) => ({ ...s, added: { ...s.added, [slipKey]: [...(s.added[slipKey] ?? []), `added-${Date.now()}`] } }))
  const removeOrderRow = (slipKey: string) => (jobId: string) =>
    setEditState((s) => {
      const slipEdits = { ...(s.edits[slipKey] ?? {}) }
      delete slipEdits[jobId]
      return { ...s, edits: { ...s.edits, [slipKey]: slipEdits }, added: { ...s.added, [slipKey]: (s.added[slipKey] ?? []).filter((id) => id !== jobId) } }
    })
  const editSlip = (slipKey: string) => (jobId: string, patch: SlipJobEdit) =>
    setEditState((s) => {
      const slip = s.edits[slipKey] ?? {}
      const prev = slip[jobId] ?? {}
      const lines = { ...(prev.lines ?? {}) }
      for (const [i, le] of Object.entries(patch.lines ?? {})) lines[Number(i)] = { ...(lines[Number(i)] ?? {}), ...le }
      const next: SlipJobEdit = { ...prev, ...patch, lines }
      return { ...s, edits: { ...s.edits, [slipKey]: { ...slip, [jobId]: next } } }
    })
  function resetEdits() {
    setEditState({ key: editsKey, edits: {}, added: {} })
    setSignatures(DEFAULT_SIGNATURES)
  }
  // "Download PDF": the browser's print dialog with the slip's own file name —
  // choose "Save as PDF". The same print copy as Print, so edits are in it
  // and no editing outlines or buttons are.
  function downloadPdf() {
    const who = allMode ? "all" : technicianName.trim().replace(/\s+/g, "-") || "slip"
    toast.info(t("releaseSlipPdfHint"))
    printAs(`release-slip-${date}-${who}`)
  }

  const { data, isPending, error } = useQuery({
    queryKey: ["releaseSlip", date, technicianId ?? null, includePending],
    queryFn: () => fetchReleaseSlip(date, technicianId, includePending),
    enabled: !!user,
  })
  // The amount to collect on each visit, for the Notes column. Collections are
  // readable by technicians; the Sale List (the C/F fallback) only by admins.
  const { data: collections = [] } = useCollections()
  const { data: saleListEntries = [] } = useSaleListEntries()
  // Repair records — a repair's Part No fills its lines when it has no stock
  // movements (repairPartLines). Readable by technicians too.
  const { data: repairPlans = [] } = useRepairPlans()
  // Pending jobs print with blank OUT lines (their collection note still shows).
  const jobs = React.useMemo(() => {
    const list = data?.jobs ?? []
    return list.map((j) => {
      const shown = j.status === "completed" ? j : { ...j, movements: [] }
      // A completed Repair with no stock movements: its Part No as lines.
      const parts = j.status === "completed" ? repairPartLines(j, repairPlans) : undefined
      return {
        ...shown,
        ...(parts ? { movements: parts } : {}),
        jobNote: collectionNoteFor(j, { date, collections, saleListEntries, slipJobs: list }),
      }
    })
  }, [data, date, collections, saleListEntries, repairPlans])
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
    enabled: !!user && !allMode,
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

  // The slips to show and print: one, or (All technicians) one per technician
  // with jobs that day, by name — a job shared by two technicians is on both
  // slips, as in the single view; jobs with no technician get an "Unassigned"
  // slip. Each technician's slip also carries the items added by hand on
  // their own slip (read here; added/removed in their single view).
  const slips = ((): { key: string; name: string; jobs: ReleaseSlipJob[] }[] => {
    if (!allMode) return [{ key: technicianId ?? "self", name: technicianName, jobs: slipJobs }]
    const byName = new Map<string, ReleaseSlipJob[]>()
    const unassigned: ReleaseSlipJob[] = []
    for (const job of jobs) {
      const names = [job.technician, job.technician2].map((n) => (n ?? "").trim()).filter((n) => isAssignedTechnician(n))
      if (names.length === 0) unassigned.push(job)
      for (const name of new Set(names)) byName.set(name, [...(byName.get(name) ?? []), job])
    }
    const list = Array.from(byName, ([name, list]) => {
      const account = technicians.find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
      const extra = mounted && account ? manualSlipJob(loadManualItems(date, account.id)) : null
      return { key: account?.id ?? name, name, jobs: extra ? [...list, extra] : list }
    }).sort((a, b) => a.name.localeCompare(b.name))
    if (unassigned.length) list.push({ key: "unassigned", name: t("releaseSlipUnassigned"), jobs: unassigned })
    return list
  })().map((slip) => ({ ...slip, jobs: applySlipEdits([...slip.jobs, ...(added[slip.key] ?? []).map(blankSlipJob)], edits[slip.key]) }))

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
            <Select value={pickedTechnician} onValueChange={setPickedTechnician}>
              <SelectTrigger className="h-8 w-52" data-testid="slip-technician">
                <SelectValue placeholder={t("releaseSlipPickTechnician")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TECHNICIANS}>{t("releaseSlipAllTechnicians")}</SelectItem>
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
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setAddOpen(true)}
            disabled={!technicianId}
            title={allMode ? t("releaseSlipAddPickTechnician") : undefined}
            data-testid="slip-add"
          >
            <Plus className="h-3.5 w-3.5" /> {t("releaseSlipAdd")}
          </Button>
        </div>
      </div>

      {/* The slip's actions: one bar above the preview. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2" data-testid="slip-toolbar">
        <Button size="sm" className="gap-1.5" onClick={downloadPdf} disabled={!ready || slips.length === 0} data-testid="slip-download-pdf">
          <Download className="h-3.5 w-3.5" /> {t("releaseSlipDownloadPdf")}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()} disabled={!ready || slips.length === 0} data-testid="slip-print">
          <Printer className="h-3.5 w-3.5" /> {t("releaseSlipPrint")}
        </Button>
        {isAdmin && (
          <>
            {!allMode && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addOrderRow(slips[0]?.key ?? technicianId ?? "self")} disabled={!ready} data-testid="slip-add-order">
                <Plus className="h-3.5 w-3.5" /> {t("releaseSlipAddOrder")}
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={resetEdits} disabled={!hasEdits} data-testid="slip-reset-edits">
              <RotateCcw className="h-3.5 w-3.5" /> {t("releaseSlipResetEdits")}
            </Button>
            <span className="text-xs text-muted-foreground">{hasEdits ? t("releaseSlipEdited") : t("releaseSlipEditHint")}</span>
          </>
        )}
      </div>

      {error ? (
        <p className="text-sm text-danger" data-testid="slip-error">
          {t("releaseSlipError")}
        </p>
      ) : !ready ? (
        <Skeleton className="h-[600px] w-[210mm] max-w-full" />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" data-testid="slip-count">
            {allMode
              ? t("releaseSlipCountAll", { count: String(jobs.length), slips: String(slips.length) })
              : t("releaseSlipCount", { count: String(jobs.length) })}
          </p>
          {allMode && slips.length === 0 && <p className="text-sm text-muted-foreground">{t("releaseSlipNoJobsDay")}</p>}
          {!allMode && manual.items.length > 0 && (
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
          {slips.length > 0 && (
            <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
              <div className="flex w-max flex-col gap-4">
                {slips.map((slip) => (
                  <div key={slip.key} className="flex flex-col gap-2" data-testid="slip-technician-block">
                    {allMode && (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold" data-testid="slip-technician-name">
                          {slip.name} · {t("releaseSlipCount", { count: String(slip.jobs.filter((j) => j.jobId !== "manual" && !j.added).length) })}
                        </p>
                        {isAdmin && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => addOrderRow(slip.key)} data-testid="slip-add-order">
                            <Plus className="h-3.5 w-3.5" /> {t("releaseSlipAddOrder")}
                          </Button>
                        )}
                      </div>
                    )}
                    <ReleaseSlipSheets
                      date={date}
                      technicianName={slip.name}
                      jobs={slip.jobs}
                      signatures={signatures}
                      onSignaturesChange={setSignatures}
                      onEdit={isAdmin ? editSlip(slip.key) : undefined}
                      onRemoveJob={isAdmin ? removeOrderRow(slip.key) : undefined}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Printed: every slip's pages in order; each technician starts on a new page. */}
          {mounted &&
            slips.length > 0 &&
            createPortal(
              <div className="release-slip-print">
                {slips.map((slip) => (
                  <ReleaseSlipSheets key={slip.key} date={date} technicianName={slip.name} jobs={slip.jobs} signatures={signatures} />
                ))}
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
