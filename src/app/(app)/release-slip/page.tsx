"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, Loader2, Plus, Printer, ReceiptText, RotateCcw, Save, X } from "lucide-react"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
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
  type SlipSkuOption,
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
import { installUnitLines, repairPartLines } from "@/lib/release-slip-repair-parts"
import { useInstallPlans } from "@/lib/hooks/use-install-plans"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
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

type SlipSaveRowInput = {
  jobId?: string
  orderNo: string
  accountName: string
  jobType: "filter_change" | "repair" | "installation" | "collection"
  items: { sku: string; qtyOut: number; qtyIn: number }[]
}

function formatSlipDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
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
  // Who may edit the slip and save it to the Daily Report: admins, and a
  // technician on their own slip (the save route checks it again).
  const canEdit = isAdmin || user?.role === "technician"
  const searchParams = useSearchParams()
  const date = validDate(searchParams.get("date")) ?? businessToday()
  const setDate = (next: string) => {
    const params = new URLSearchParams(window.location.search)
    params.set("date", next)
    window.history.replaceState(null, "", `?${params.toString()}`)
  }
  const [includePending, setIncludePending] = React.useState(false)
  // Same-account orders as one block on the slip (both order numbers, items
  // added up); untick to see and edit each order on its own.
  const [combineAccounts, setCombineAccounts] = React.useState(true)
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
  // Installation records — an installation with no stock movement shows its
  // unit (Model, else the order's Product #) with the code as SKU.
  const { data: installPlans = [] } = useInstallPlans()
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  // Jobs whose record was cancelled (e.g. from the Daily Report) leave the
  // slip — the database also cancels the job itself (see the
  // 20261115000000 migration); this covers records cancelled before that.
  const cancelledJobIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const r of [...filterChangePlans, ...repairPlans, ...installPlans, ...collections] as { scheduleJobId?: string; status?: string }[])
      if (r.scheduleJobId && r.status === "Cancelled") ids.add(r.scheduleJobId)
    return ids
  }, [filterChangePlans, repairPlans, installPlans, collections])
  // Collections set back to Pending (not collected) leave the slip as done
  // visits — the database also puts their job back to pending
  // (20261117000000); "Include pending jobs" still lists them to collect.
  const uncollectedJobIds = React.useMemo(
    () => new Set(collections.filter((c) => c.scheduleJobId && c.status === "Pending").map((c) => c.scheduleJobId as string)),
    [collections]
  )
  // Each job with its items and the money to collect on the visit.
  const jobs = React.useMemo(() => {
    const list = (data?.jobs ?? []).filter(
      (j) => !cancelledJobIds.has(j.jobId) && !(j.jobType === "collection" && j.status === "completed" && uncollectedJobIds.has(j.jobId))
    )
    return list.map((j) => {
      // Pending jobs ("Include pending jobs") show what's already queued for
      // them too — an installation's unit, a filter change's filters (marked
      // * while awaiting approval) — instead of blank lines. A Repair with no
      // stock movements: its Part No as lines; an Installation with none: its
      // unit (installUnitLines).
      const parts = repairPartLines(j, repairPlans) ?? installUnitLines(j, installPlans, saleListEntries)
      return {
        ...j,
        ...(parts ? { movements: parts } : {}),
        jobNote: collectionNoteFor(j, { date, collections, saleListEntries, slipJobs: list }),
      }
    })
  }, [data, date, collections, saleListEntries, repairPlans, installPlans, cancelledJobIds, uncollectedJobIds])
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
  // Every SKU (code + name) for the slip's SKU cells — served by
  // /api/release-slip/skus so technicians get it too.
  const { data: skuOptions = [] } = useQuery({
    queryKey: ["releaseSlipSkus"],
    queryFn: async (): Promise<SlipSkuOption[]> => {
      const res = await fetch("/api/release-slip/skus")
      if (!res.ok) return []
      return ((await res.json()).skus ?? []) as SlipSkuOption[]
    },
    enabled: !!user && canEdit,
    staleTime: 5 * 60_000,
  })
  const productOptions = React.useMemo(() => {
    const fromProducts = [...new Set(products.map((p) => (p.sku || p.name).trim()).filter(Boolean))].sort()
    // A technician has no product list: the SKU list instead.
    const values = fromProducts.length ? fromProducts : skuOptions.map((o) => o.sku)
    return values.map((value) => ({ value }))
  }, [products, skuOptions])
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

  // "Save to Daily Report": the slip's rows → completed visits on this date
  // for this technician, their items queued in Inventory (pending). Sent:
  // rows added here, jobs edited here, and jobs not completed yet. A row
  // added without an F / R / S / O box is held back (named in a message).
  const qc = useQueryClient()
  const [pendingSave, setPendingSave] = React.useState<{ rows: SlipSaveRowInput[] } | null>(null)
  const [saving, setSaving] = React.useState(false)
  // The rows to send. "all" (the button): rows added or edited here plus
  // every job not completed yet. "edited" (auto-save): only rows added or
  // edited here. sourceIds: the slip job ids sent (added rows' local ids).
  function buildRows(mode: "all" | "edited") {
    const slip = slips[0]
    const rows: SlipSaveRowInput[] = []
    const noType: string[] = []
    const sourceIds: string[] = []
    if (!slip || allMode) return { rows, noType, sourceIds, slipKey: "" }
    const slipEdits = edits[slip.key] ?? {}
    const original = new Map((data?.jobs ?? []).map((j) => [j.jobId, j]))
    for (const job of slip.jobs) {
      if (job.jobId === "manual") continue
      const orig = original.get(job.jobId)
      const touched = job.added || !!slipEdits[job.jobId]
      const include = touched || (mode === "all" && (orig ? orig.status !== "completed" : false))
      if (!include) continue
      if (job.added && !job.orderNo.trim()) continue
      if (!["filter_change", "repair", "installation", "collection"].includes(job.jobType)) {
        noType.push(job.orderNo || "—")
        continue
      }
      const items = job.movements.flatMap((m) => {
        if (m.errand) return []
        const out = { sku: (m.sku || m.label).trim(), qtyOut: m.qtyOut || 0, qtyIn: m.inSku ? 0 : m.qtyIn || 0, purpose: m.purpose, slipType: m.slipType }
        const back = m.inSku && m.qtyIn ? [{ sku: m.inSku.trim(), qtyOut: 0, qtyIn: m.qtyIn, purpose: m.purpose, slipType: m.slipType }] : []
        return [...(out.sku && (out.qtyOut || out.qtyIn) ? [out] : []), ...back]
      })
      rows.push({ jobId: job.added ? undefined : job.jobId, orderNo: job.orderNo, accountName: job.accountName, jobType: job.jobType as SlipSaveRowInput["jobType"], items })
      sourceIds.push(job.jobId)
    }
    return { rows, noType, sourceIds, slipKey: slip.key }
  }
  async function postSave(rows: SlipSaveRowInput[]) {
    const res = await fetch("/api/release-slip/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, technicianUserId: technicianId, rows }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || "Save failed")
    if (body.skipped?.length) {
      toast.error(t("releaseSlipSaveSkipped", { count: String(body.skipped.length), details: body.skipped.map((s: { orderNo: string; reason: string }) => `${s.orderNo}: ${s.reason}`).join("; ") }))
    }
    for (const key of [["releaseSlip"], ["scheduleJobs"], ["filterChangePlans"], ["installPlans"], ["repairPlans"], ["collections"], ["stockMovements"]]) {
      qc.invalidateQueries({ queryKey: key })
    }
    return body as { completed: number; alreadyCompleted: number; created: number; movements: number }
  }
  function startSave() {
    const { rows, noType } = buildRows("all")
    if (noType.length) toast.warning(t("releaseSlipSaveNoType", { orders: noType.join(", ") }))
    if (rows.length === 0) {
      if (!noType.length) toast.info(t("releaseSlipSaveNothing"))
      return
    }
    setPendingSave({ rows })
  }

  // "Add Item / Task" rows → Inventory: each one with an item is queued as a
  // pending movement (and taken back out if removed while still pending), so
  // it shows in the Inventory List for an admin to approve.
  async function queueManualItem(item: ManualSlipItem): Promise<string | undefined> {
    if (!item.item.trim() || !(item.qty > 0) || !technicianId) return undefined
    const res = await fetch("/api/release-slip/manual-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, technicianUserId: technicianId, item }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || "Couldn't add it to the Inventory List")
    return body.id as string
  }
  async function addManualItem(item: ManualSlipItem) {
    let movementId: string | undefined
    try {
      movementId = await queueManualItem(item)
      if (movementId) qc.invalidateQueries({ queryKey: ["stockMovements"] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add it to the Inventory List")
    }
    setManualItems([...manual.items, { ...item, movementId }])
  }
  async function removeManualItem(item: ManualSlipItem) {
    if (item.movementId) {
      const res = await fetch(`/api/release-slip/manual-item?id=${encodeURIComponent(item.movementId)}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || "Couldn't remove it from the Inventory List")
        return
      }
      qc.invalidateQueries({ queryKey: ["stockMovements"] })
    }
    setManualItems(manual.items.filter((x) => x.id !== item.id))
  }
  // Rows added before this (kept only in the browser) are queued once.
  const syncedManualKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!canEdit || allMode || !technicianId || !manualKey || manual.key !== manualKey) return
    if (syncedManualKey.current === manualKey) return
    syncedManualKey.current = manualKey
    const missing = manual.items.filter((i) => !i.movementId && i.item.trim() && i.qty > 0)
    if (missing.length === 0) return
    ;(async () => {
      const ids = new Map<string, string>()
      for (const i of missing) {
        try {
          const id = await queueManualItem(i)
          if (id) ids.set(i.id, id)
        } catch {
          // left unqueued; tried again next time the slip opens
        }
      }
      if (ids.size) {
        const current = loadManualItems(date, technicianId)
        saveManualItems(date, technicianId, current.map((i) => (ids.has(i.id) ? { ...i, movementId: ids.get(i.id) } : i)))
        setManual({ key: manualKey, items: loadManualItems(date, technicianId) })
        qc.invalidateQueries({ queryKey: ["stockMovements"] })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, manualKey, canEdit, allMode, technicianId])

  // Auto-save: a row edited or added here is saved to the Daily Report as a
  // completed visit (and the technician's schedule) a moment after the last
  // edit — once an added row has its Order No. and type box. The saved rows'
  // edits are then dropped so the slip shows what the database now holds;
  // anything edited again while saving stays and saves on the next round.
  const [autoStatus, setAutoStatus] = React.useState<{ state: "idle" | "saving" | "saved"; at?: string }>({ state: "idle" })
  const autoRunning = React.useRef(false)
  React.useEffect(() => {
    if (!canEdit || allMode || !technicianId || saving) return
    const { rows, sourceIds, slipKey } = buildRows("edited")
    if (rows.length === 0) return
    // The edits being saved — anything changed after this stays for next time.
    const snapshot = editState
    const timer = window.setTimeout(async () => {
      if (autoRunning.current) return
      autoRunning.current = true
      setAutoStatus({ state: "saving" })
      try {
        await postSave(rows)
        setEditState((s) => {
          if (s.key !== snapshot.key) return s
          const slipEdits = { ...(s.edits[slipKey] ?? {}) }
          for (const id of sourceIds) if (slipEdits[id] === snapshot.edits[slipKey]?.[id]) delete slipEdits[id]
          const added = (s.added[slipKey] ?? []).filter((id) => !(sourceIds.includes(id) && s.edits[slipKey]?.[id] === snapshot.edits[slipKey]?.[id]))
          return { ...s, edits: { ...s.edits, [slipKey]: slipEdits }, added: { ...s.added, [slipKey]: added } }
        })
        setAutoStatus({ state: "saved", at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) })
      } catch (e) {
        setAutoStatus({ state: "idle" })
        toast.error(e instanceof Error ? e.message : "Save failed")
      } finally {
        autoRunning.current = false
      }
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editState, canEdit, allMode, technicianId, saving, data])
  async function confirmSave() {
    if (!pendingSave) return
    setSaving(true)
    try {
      const body = await postSave(pendingSave.rows)
      toast.success(t("releaseSlipSaved", { completed: String(body.completed + body.alreadyCompleted), created: String(body.created), movements: String(body.movements) }))
      setPendingSave(null)
      resetEdits()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

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
          <label className="flex items-center gap-2 text-sm" title="Orders with the same account name and job type print as one block (items added up). Untick to edit each order on its own.">
            <Checkbox checked={combineAccounts} onCheckedChange={(v) => setCombineAccounts(v === true)} data-testid="slip-combine-accounts" />
            Combine same account
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
        {canEdit && (
          <>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={startSave}
              disabled={!ready || allMode || saving}
              title={allMode ? t("releaseSlipSaveAllHint") : undefined}
              data-testid="slip-save"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {t("releaseSlipSave")}
            </Button>
            {!allMode && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => addOrderRow(slips[0]?.key ?? technicianId ?? "self")} disabled={!ready} data-testid="slip-add-order">
                <Plus className="h-3.5 w-3.5" /> {t("releaseSlipAddOrder")}
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={resetEdits} disabled={!hasEdits} data-testid="slip-reset-edits">
              <RotateCcw className="h-3.5 w-3.5" /> {t("releaseSlipResetEdits")}
            </Button>
            <span className="text-xs text-muted-foreground" data-testid="slip-autosave-status">
              {autoStatus.state === "saving"
                ? t("releaseSlipAutoSaving")
                : autoStatus.state === "saved"
                  ? t("releaseSlipAutoSaved", { time: autoStatus.at ?? "" })
                  : allMode
                    ? t("releaseSlipSaveAllHint")
                    : t("releaseSlipAutoHint")}
            </span>
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
                      onClick={() => removeManualItem(i)}
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
                      onEdit={canEdit ? editSlip(slip.key) : undefined}
                      onRemoveJob={canEdit ? removeOrderRow(slip.key) : undefined}
                      skuOptions={canEdit ? skuOptions : undefined}
                      combine={combineAccounts}
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
                  <ReleaseSlipSheets key={slip.key} date={date} technicianName={slip.name} jobs={slip.jobs} signatures={signatures} combine={combineAccounts} />
                ))}
              </div>,
              document.body
            )}
        </>
      )}
      <ConfirmDialog
        open={!!pendingSave}
        onOpenChange={(o) => !o && !saving && setPendingSave(null)}
        title={t("releaseSlipSaveTitle")}
        description={pendingSave ? t("releaseSlipSaveDescription", { count: String(pendingSave.rows.length), date: formatSlipDate(date), name: technicianName || "—" }) : ""}
        confirmLabel={t("releaseSlipSave")}
        destructive={false}
        loading={saving}
        onConfirm={confirmSave}
      />
      <AddSlipItemDialog open={addOpen} onOpenChange={setAddOpen} productOptions={productOptions} noteSuggestions={noteSuggestions} onAdd={addManualItem} />
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
