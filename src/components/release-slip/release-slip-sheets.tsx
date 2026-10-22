"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import type { ReleaseSlipJob, ReleaseSlipMovement } from "@/lib/api/release-slip"
import { formatDate } from "@/lib/utils"

// The printed Release Slip, laid out like the paper form: A4 portrait, black
// on white whatever the app theme, up to 12 jobs per page. Labels stay in
// English, like the app's other printed forms.
//
// Every job block has at least LINES_PER_JOB item lines (a blank one is left
// for handwriting). A page holds up to JOBS_PER_PAGE jobs and LINES_PER_PAGE
// item lines; a job with more items gets a taller block and the jobs after it
// move to the next page; a job longer than a whole page continues on the next
// page "(cont.)". The Summary and the signature lines go on the last page, or
// on a page of their own when they don't fit under the last jobs.

export const LINES_PER_JOB = 3
const JOBS_PER_PAGE = 12
// Item lines on a page without the Summary (header and table head take the rest).
const LINES_PER_PAGE = 44
// Room on one page for item lines + the Summary block, in line heights.
const PAGE_CAPACITY = 46
const MIN_SUMMARY_ROWS = 4
// The signature column beside the Summary is about this many lines tall, so
// the bottom block never takes less.
const SIGNATURE_LINES = 9

// offset: the position of the block's first line among the job's lines.
// itemLines: the job's own item lines; collections: same-order collection
// jobs shown in this block, one line each after the item lines.
// A slip job as shown — possibly several same-account orders combined into
// one block (combineSameAccount): orderNos lists them, combinedIds their
// jobs. Its first summedLines lines are the summed items (read-only); after
// them come the first order's lines still being typed (no quantity yet),
// lineMap giving each one's line in that order; a line past all of them goes
// to the first order's line editOffset + n.
type SlipJob = ReleaseSlipJob & {
  orderNos?: string[]
  combinedIds?: string[]
  // Each combined order with its job (for its × on the slip).
  combinedOrders?: { jobId: string; orderNo: string }[]
  summedLines?: number
  editOffset?: number
  lineMap?: Record<number, number>
}

type Block = {
  job: SlipJob
  movements: ReleaseSlipMovement[]
  lines: number
  itemLines: number
  continued: boolean
  offset: number
  collections: ReleaseSlipJob[]
}
type Page = { blocks: Block[]; summary: boolean }

// Same account, same job type → one block: both order numbers in the Order
// No box and each SKU's quantity added up ("012" 1 + 1 = 2). Never an added
// row, a hand-typed block or a collection (those join their visit's block —
// mergeCollections). The block sits where the first of them was.
export function combineSameAccount(jobs: ReleaseSlipJob[]): SlipJob[] {
  const keyOf = (j: ReleaseSlipJob) =>
    j.added || j.jobType === MANUAL_JOB_TYPE || j.jobType === "collection" || !j.accountName.trim()
      ? null
      : `${j.jobType}|${j.accountName.trim().toLowerCase()}`
  const groups = new Map<string, ReleaseSlipJob[]>()
  for (const j of jobs) {
    const k = keyOf(j)
    if (k) groups.set(k, [...(groups.get(k) ?? []), j])
  }
  const out: SlipJob[] = []
  const done = new Set<string>()
  for (const j of jobs) {
    const k = keyOf(j)
    const group = k ? groups.get(k)! : [j]
    if (group.length < 2) {
      out.push(j)
      continue
    }
    if (done.has(k!)) continue
    done.add(k!)
    // Summed per code: OUT and IN separately, a code with both on one line.
    // Keyed by code AND the line's type box, so items ticked R stay apart
    // from the job's own (F) ones; grouped by type, the job's own type first.
    const keyOf2 = (code: string, type?: string) => `${type ?? ""}|${code}`
    const outs = new Map<string, { qty: number; pending: boolean }>()
    const ins = new Map<string, { qty: number; pending: boolean }>()
    for (const g of group)
      for (const m of slipItems(g)) {
        const pending = m.status === "pending"
        if (m.qtyOut) {
          const k = keyOf2(itemName(m), m.slipType)
          const e = outs.get(k) ?? { qty: 0, pending: false }
          outs.set(k, { qty: e.qty + m.qtyOut, pending: e.pending || pending })
        }
        if (m.qtyIn) {
          const k = keyOf2(inItemName(m), m.slipType)
          const e = ins.get(k) ?? { qty: 0, pending: false }
          ins.set(k, { qty: e.qty + m.qtyIn, pending: e.pending || pending })
        }
      }
    const keys = [...new Set([...outs.keys(), ...ins.keys()])].sort((a, b) => {
      const [ta, ca] = [a.slice(0, a.indexOf("|")), a.slice(a.indexOf("|") + 1)]
      const [tb, cb] = [b.slice(0, b.indexOf("|")), b.slice(b.indexOf("|") + 1)]
      if (ta !== tb) return ta === "" ? -1 : tb === "" ? 1 : ta.localeCompare(tb)
      return ca.localeCompare(cb, undefined, { numeric: true })
    })
    const summedItems: ReleaseSlipMovement[] = keys.map((k) => {
      const o = outs.get(k)
      const i = ins.get(k)
      const type = k.slice(0, k.indexOf("|"))
      const code = k.slice(k.indexOf("|") + 1)
      return { sku: code, label: code, qtyOut: o?.qty ?? 0, qtyIn: i?.qty ?? 0, status: o?.pending || i?.pending ? "pending" : "recorded", slipType: type || undefined }
    })
    const first = group[0]
    // The first order's lines typed here but not finished (a code without a
    // quantity yet): kept in the block and tied to their own line, so the
    // quantity typed next lands on the same line.
    const firstItems = slipItems(first)
    const inProgress = firstItems.map((m, i) => ({ m, i })).filter(({ m }) => !m.qtyOut && !m.qtyIn)
    const movements = [...summedItems, ...inProgress.map(({ m }) => m)]
    const lineMap: Record<number, number> = {}
    inProgress.forEach(({ i }, k) => {
      lineMap[summedItems.length + k] = i
    })
    out.push({
      ...first,
      movements,
      orderNos: [...new Set(group.map((g) => g.orderNo.trim()).filter(Boolean))],
      combinedIds: group.map((g) => g.jobId),
      combinedOrders: group.map((g) => ({ jobId: g.jobId, orderNo: g.orderNo.trim() })),
      summedLines: summedItems.length,
      editOffset: firstItems.length,
      lineMap,
      jobNote: [...new Set(group.map((g) => (g.jobNote ?? "").trim()).filter(Boolean))].join(" · ") || undefined,
    })
  }
  return out
}

// The block of rows added by hand on the slip page (no type box ticked).
export const MANUAL_JOB_TYPE = "manual"

export function typeBox(jobType: string): "F" | "R" | "S" | "O" | null {
  if (jobType === MANUAL_JOB_TYPE) return null
  if (jobType === "filter_change") return "F"
  if (jobType === "repair") return "R"
  if (jobType === "installation") return "S"
  return "O"
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ""))
const itemName = (m: ReleaseSlipMovement) => m.sku || m.label
const inItemName = (m: ReleaseSlipMovement) => m.inSku ?? itemName(m)
// The lines a job prints: anything with a quantity or a note, plus lines an
// admin has edited (kept even while blank, so line numbers stay put).
const slipItems = (job: ReleaseSlipJob) => job.movements.filter((m) => m.qtyOut || m.qtyIn || m.note || m.edited)

export function buildSummary(jobs: ReleaseSlipJob[]) {
  const map = new Map<string, { sku: string; out: number; in: number; pending: boolean }>()
  const add = (key: string, out: number, inQty: number, pending: boolean) => {
    if (!key) return
    const row = map.get(key) ?? { sku: key, out: 0, in: 0, pending: false }
    row.out += out
    row.in += inQty
    if (pending) row.pending = true
    map.set(key, row)
  }
  for (const j of jobs)
    for (const m of j.movements) {
      if (m.errand) continue
      if (m.qtyOut) add(itemName(m), m.qtyOut, 0, m.status === "pending")
      if (m.qtyIn) add(inItemName(m), 0, m.qtyIn, m.status === "pending")
    }
  return [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku))
}

// Admin edits typed on the slip page — on top of the database values, never
// saved; "Reset Edits" drops them. Keyed by job id (per slip); a line by its
// position in the job's printed lines (a blank line past the last item adds
// a new one). Quantities are kept as typed and read as numbers.
export type SlipLineEdit = { outSku?: string; outQty?: string; inSku?: string; inQty?: string; note?: string; purpose?: string; lineType?: string }

// What a slip item is for — picked per line on the on-screen copy (the "For"
// box in Notes), saved with the item and shown in the Daily Report's
// Inventory List with who added it. Printed in the Notes column.
export const SLIP_PURPOSES = ["Parts", "Filter", "Unit", "Return", "Errand", "Other"] as const
export type SlipJobEdit = { orderNo?: string; jobType?: string; accountName?: string; jobNote?: string; lines?: Record<number, SlipLineEdit> }

// The job type each box stands for, when an admin ticks one on an added row.
const BOX_JOB_TYPE = { F: "filter_change", R: "repair", S: "installation", O: "collection" } as const

// A blank order row for "+ Add Order No." (no box ticked until one is clicked).
export function blankSlipJob(jobId: string): ReleaseSlipJob {
  return { jobId, orderNo: "", accountName: "", jobType: MANUAL_JOB_TYPE, status: "completed", technician: "", technician2: "", movements: [], added: true }
}
export type SlipEdits = Record<string, SlipJobEdit>

const toQty = (text: string) => {
  const n = Number(text.replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) ? n : 0
}

export function applySlipEdits(jobs: ReleaseSlipJob[], edits: SlipEdits | undefined): ReleaseSlipJob[] {
  if (!edits || !Object.keys(edits).length) return jobs
  return jobs.map((job) => {
    const e = edits[job.jobId]
    if (!e) return job
    const items = [...slipItems(job)]
    const lineEdits = e.lines ?? {}
    const last = Math.max(-1, ...Object.keys(lineEdits).map(Number))
    for (let i = 0; i <= last; i++) {
      const le = lineEdits[i]
      if (!le) continue
      const base = items[i] ?? { sku: "", label: "", qtyOut: 0, qtyIn: 0, status: "manual" }
      const outSku = (le.outSku ?? (base.qtyOut ? itemName(base) : "")).trim()
      const inSku = (le.inSku ?? (base.qtyIn ? inItemName(base) : "")).trim()
      const outQty = le.outQty !== undefined ? toQty(le.outQty) : base.qtyOut
      const inQty = le.inQty !== undefined ? toQty(le.inQty) : base.qtyIn
      const sku = outSku || inSku
      while (items.length < i) items.push({ sku: "", label: "", qtyOut: 0, qtyIn: 0, status: "manual", edited: true })
      items[i] = {
        ...base,
        sku,
        label: sku,
        qtyOut: outSku ? outQty || 0 : 0,
        qtyIn: inSku ? inQty || 0 : 0,
        inSku: inSku && inSku !== sku ? inSku : undefined,
        note: le.note ?? base.note,
        purpose: le.purpose ?? base.purpose,
        slipType: le.lineType !== undefined ? le.lineType || undefined : base.slipType,
        edited: true,
      }
    }
    return {
      ...job,
      orderNo: e.orderNo ?? job.orderNo,
      jobType: e.jobType ?? job.jobType,
      accountName: e.accountName ?? job.accountName,
      jobNote: e.jobNote ?? job.jobNote,
      movements: items,
    }
  })
}

// One editable cell on the admin's on-screen copy: typed straight into the
// slip (contentEditable), saved when it loses focus (Enter too, except in a
// multi-line cell). Remounted when its value changes, so "Reset Edits" puts
// the original text back. Plain text everywhere else, the print copy included.
function Editable({
  value,
  onCommit,
  multiline,
  label,
}: {
  value: string
  onCommit?: (next: string) => void
  multiline?: boolean
  label: string
}) {
  if (!onCommit) return <>{value}</>
  return (
    <span
      key={value}
      className={multiline ? "slip-edit slip-edit-block" : "slip-edit"}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={label}
      data-testid="slip-edit"
      onBlur={(e) => {
        const next = (e.currentTarget.textContent ?? "").replace(/\s+/g, " ").trim()
        if (next !== value) onCommit(next)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault()
          e.currentTarget.blur()
        }
        if (e.key === "Escape") {
          e.currentTarget.textContent = value
          e.currentTarget.blur()
        }
      }}
    >
      {value}
    </span>
  )
}

// A collection on the same order as another job of the slip (a Filter
// Change and its payment, say) is shown in that job's block — its O box
// ticked and the collection on a line of its own — instead of a second block.
// Only a collection with no items of its own, and never an added row.
function mergeCollections(jobs: SlipJob[]) {
  const into = new Map<string, ReleaseSlipJob[]>()
  const merged = new Set<string>()
  for (const c of jobs) {
    const order = c.orderNo.trim()
    if (c.jobType !== "collection" || c.added || !order || slipItems(c).length) continue
    const host = jobs.find(
      (j) => j !== c && !j.added && j.jobType !== "collection" && j.jobType !== MANUAL_JOB_TYPE && (j.orderNos ?? [j.orderNo]).some((o) => o.trim() === order)
    )
    if (!host) continue
    into.set(host.jobId, [...(into.get(host.jobId) ?? []), c])
    merged.add(c.jobId)
  }
  return { into, merged }
}

// minLines: a job's line count raised with "+ Add line" (on-screen copy).
// A SKU cell on the on-screen copy: click it to see every SKU (code + name),
// type to narrow the list or to enter any code, pick one with a click or
// Enter. Saved like Editable (on pick, Enter or leaving the cell); Escape
// puts the old value back. The list opens in a layer over the page so the
// table's cells don't clip it. Plain text on the print copy.
export type SlipSkuOption = { sku: string; name: string }

function SkuCell({
  value,
  onCommit,
  options,
  label,
}: {
  value: string
  onCommit?: (next: string) => void
  options?: SlipSkuOption[]
  label: string
}) {
  if (!onCommit) return <>{value}</>
  if (!options?.length) return <Editable value={value} onCommit={onCommit} label={label} />
  return <SkuPicker key={value} value={value} onCommit={onCommit} options={options} label={label} />
}

function SkuPicker({ value, onCommit, options, label }: { value: string; onCommit: (next: string) => void; options: SlipSkuOption[]; label: string }) {
  const [text, setText] = React.useState(value)
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // True from a press on the list until shortly after it ends.
  const pressingMenu = React.useRef(false)
  const textRef = React.useRef(text)
  React.useEffect(() => {
    textRef.current = text
  }, [text])
  const query = text.trim().toLowerCase()
  // Everything until the admin/technician types something different from
  // the cell's value; then SKUs starting with it first, then name matches.
  const shown = React.useMemo(() => {
    if (!query || query === value.trim().toLowerCase()) return options
    const starts = options.filter((o) => o.sku.toLowerCase().startsWith(query))
    const rest = options.filter((o) => !o.sku.toLowerCase().startsWith(query) && (o.sku.toLowerCase().includes(query) || o.name.toLowerCase().includes(query)))
    return [...starts, ...rest]
  }, [options, query, value])

  const show = () => {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    setOpen(true)
  }
  // The list follows its cell when the page scrolls or resizes — on a phone
  // the keyboard opening scrolls the page right as the list opens. Scrolling
  // inside the list itself is ignored.
  React.useEffect(() => {
    if (!open) return
    const follow = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".slip-sku-menu")) return
      if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    }
    window.addEventListener("scroll", follow, true)
    window.addEventListener("resize", follow)
    return () => {
      window.removeEventListener("scroll", follow, true)
      window.removeEventListener("resize", follow)
    }
  }, [open])
  // Kept inside the screen: never past the right edge (a narrow phone, a
  // cell near the right), and above the cell when there's no room below.
  const menuStyle = (r: DOMRect): React.CSSProperties => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const maxWidth = Math.min(360, vw - 16)
    const minWidth = Math.min(Math.max(r.width, 260), maxWidth)
    const left = Math.max(8, Math.min(r.left, vw - maxWidth - 8))
    const below = vh - r.bottom - 8
    const above = r.top - 8
    const up = below < 180 && above > below
    return up
      ? { bottom: vh - r.top + 2, left, minWidth, maxWidth, maxHeight: Math.min(260, above) }
      : { top: r.bottom + 2, left, minWidth, maxWidth, maxHeight: Math.min(260, Math.max(below, 120)) }
  }
  const commit = (next: string) => {
    const clean = next.replace(/\s+/g, " ").trim()
    pressingMenu.current = false
    setOpen(false)
    setText(clean)
    if (clean !== value) onCommit(clean)
  }
  const pick = (sku: string) => {
    commit(sku)
    inputRef.current?.blur()
  }
  // While open: a press on the list is remembered (so the cell's blur
  // doesn't close it mid-tap); a press anywhere else saves what's typed and
  // closes it — including after a swipe on the list moved focus away.
  const commitRef = React.useRef(commit)
  React.useEffect(() => {
    commitRef.current = commit
  })
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest(".slip-sku-menu")) {
        pressingMenu.current = true
        return
      }
      if (target && target === inputRef.current) return
      if (pressingMenu.current || document.activeElement !== inputRef.current) commitRef.current(textRef.current)
    }
    document.addEventListener("pointerdown", onDown, true)
    return () => document.removeEventListener("pointerdown", onDown, true)
  }, [open])

  return (
    <>
      <input
        ref={inputRef}
        className="slip-edit slip-sku-input"
        value={text}
        aria-label={label}
        data-testid="slip-sku-input"
        autoComplete="off"
        onFocus={show}
        onClick={show}
        onChange={(e) => {
          setText(e.target.value)
          setActive(0)
          show()
        }}
        // Leaving the cell saves the typed text — but not while the list is
        // being touched (a phone moves focus off the cell before the tap
        // on an option lands); touching elsewhere closes it (see below).
        onBlur={() => {
          if (!pressingMenu.current) commit(text)
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            show()
            setActive((a) => Math.min(a + 1, shown.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === "Enter") {
            e.preventDefault()
            const typedOther = query && query !== value.trim().toLowerCase()
            commit(open && typedOther && shown[active] ? shown[active].sku : text)
            e.currentTarget.blur()
          } else if (e.key === "Escape") {
            setText(value)
            setOpen(false)
            e.currentTarget.blur()
          }
        }}
      />
      {open &&
        rect &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            className="slip-sku-menu"
            role="listbox"
            aria-label={label}
            data-testid="slip-sku-menu"
            style={menuStyle(rect)}
          >
            {shown.length === 0 ? (
              <li className="slip-sku-empty">No SKU matches — press Enter to keep “{text.trim()}”</li>
            ) : (
              shown.map((o, i) => (
                <li
                  key={o.sku}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "slip-sku-option is-active" : "slip-sku-option"}
                  // A tap or click picks (a swipe to scroll the list doesn't).
                  onClick={() => pick(o.sku)}
                  onMouseEnter={() => setActive(i)}
                >
                  <b>{o.sku}</b>
                  <span>{o.name}</span>
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </>
  )
}

export function paginate(jobs: SlipJob[], summaryRows: number, minLines: Record<string, number> = {}): Page[] {
  const { into, merged } = mergeCollections(jobs)
  // Split a job longer than a whole page into page-sized chunks.
  const blocks: Block[] = []
  for (const job of jobs) {
    if (merged.has(job.jobId)) continue
    const items = slipItems(job)
    const collections = into.get(job.jobId) ?? []
    const itemLines = Math.max(collections.length ? LINES_PER_JOB - 1 : LINES_PER_JOB, items.length, minLines[job.jobId] ?? 0)
    if (itemLines + collections.length <= LINES_PER_PAGE) {
      blocks.push({ job, movements: items, itemLines, lines: itemLines + collections.length, continued: false, offset: 0, collections })
    } else {
      for (let i = 0; i < items.length; i += LINES_PER_PAGE) {
        const chunk = items.slice(i, i + LINES_PER_PAGE)
        const n = Math.max(LINES_PER_JOB, chunk.length)
        blocks.push({ job, movements: chunk, itemLines: n, lines: n, continued: i > 0, offset: i, collections: [] })
      }
      const tail = blocks[blocks.length - 1]
      if (collections.length && tail.lines + collections.length <= LINES_PER_PAGE) {
        tail.collections = collections
        tail.lines += collections.length
      }
    }
  }
  const pages: Page[] = []
  let current: Block[] = []
  let used = 0
  for (const b of blocks) {
    if (current.length && (current.length === JOBS_PER_PAGE || used + b.lines > LINES_PER_PAGE)) {
      pages.push({ blocks: current, summary: false })
      current = []
      used = 0
    }
    current.push(b)
    used += b.lines
  }
  if (current.length || pages.length === 0) pages.push({ blocks: current, summary: false })
  // Summary block: title + header + its rows.
  const summaryLines = Math.max(SIGNATURE_LINES, 2 + Math.max(MIN_SUMMARY_ROWS, summaryRows))
  const last = pages[pages.length - 1]
  const lastLines = last.blocks.reduce((sum, b) => sum + b.lines, 0)
  if (lastLines + summaryLines <= PAGE_CAPACITY) last.summary = true
  else pages.push({ blocks: [], summary: true })
  return pages
}

export interface SlipSignatures {
  checkedBy: string
  notedBy: string
  approvedBy: string
  // The Store line as typed (Shopee / Lazada slip, whoEditable); unset = the
  // store's own name.
  who?: string
}

export function ReleaseSlipSheets({
  date,
  technicianName,
  jobs,
  signatures,
  onSignaturesChange,
  onEdit,
  onRemoveJob,
  onRemoveOrder,
  skuOptions,
  combine = true,
  whoLabel = "Technician:",
  whoEditable = false,
  typeBoxes = true,
}: {
  date: string
  technicianName: string
  jobs: ReleaseSlipJob[]
  signatures: SlipSignatures
  // Given on the on-screen copy: the three names are editable boxes there.
  // The print copy shows them as plain text.
  onSignaturesChange?: (next: SlipSignatures) => void
  // Given on an admin's on-screen copy: Accnt. Name, SKU, Qty and Notes are
  // typed straight into the slip (see applySlipEdits). The print copy never
  // gets it, so nothing editable shows on paper or in the PDF.
  onEdit?: (jobId: string, patch: SlipJobEdit) => void
  // Removes an added order row (its × on the admin's on-screen copy).
  onRemoveJob?: (jobId: string) => void
  // Removes an order from the slip (its × beside the Order No. on the
  // on-screen copy): every job of that order shown in the block.
  onRemoveOrder?: (jobIds: string[], orderNo: string) => void
  // Every SKU, for the on-screen SKU cells' pick list (SkuCell).
  skuOptions?: SlipSkuOption[]
  // Same-account orders shown as one block (combineSameAccount).
  combine?: boolean
  // The header / signature label for whose slip it is ("Store:" on the
  // Shopee / Lazada slip).
  whoLabel?: string
  // true: that line is a typed box too (signatures.who), shown in the header.
  whoEditable?: boolean
  // false: the F / R / S / O boxes stay blank and can't be ticked (online
  // orders have no job type).
  typeBoxes?: boolean
}) {
  // Errands done together: the technician's partner on any of these jobs is
  // named with them ("Jerson Capellan & Jeric Salirio") in the header and on
  // the Technician signature line.
  const crewName = React.useMemo(() => {
    const own = technicianName.trim()
    if (!own) return technicianName
    const names = [own]
    for (const j of jobs)
      for (const n of [j.technician, j.technician2]) {
        const name = (n ?? "").trim()
        if (name && !names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name)
      }
    return names.join(" & ")
  }, [technicianName, jobs])
  const summary = React.useMemo(() => buildSummary(jobs), [jobs])
  // Lines added with "+ Add line" (on-screen copy only; a filled one prints).
  const [minLines, setMinLines] = React.useState<Record<string, number>>({})
  const shownJobs = React.useMemo(() => (combine ? combineSameAccount(jobs) : jobs), [jobs, combine])
  const pages = React.useMemo(() => paginate(shownJobs, summary.length, onEdit ? minLines : {}), [shownJobs, summary.length, minLines, onEdit])
  const summaryRows = [...summary, ...Array.from({ length: Math.max(0, MIN_SUMMARY_ROWS - summary.length) }, () => null)]

  // An order's × (on-screen copy, not on a continued block): removes it and
  // the same-order collection shown with it.
  const removeOrderButton = (b: Block, orderNo: string, jobIds: string[]) => {
    if (!onRemoveOrder || b.continued || !jobIds.length) return null
    const ids = [...jobIds, ...b.collections.filter((c) => c.orderNo.trim() === orderNo).map((c) => c.jobId)]
    return (
      <button type="button" className="slip-remove" onClick={() => onRemoveOrder(ids, orderNo)} aria-label={`Remove ${orderNo} from this slip`} title="Remove from this slip" data-testid="slip-remove-order">
        ×
      </button>
    )
  }
  const signature = (label: string, key: keyof SlipSignatures | null, value: string) => (
    <div className="slip-sign">
      <span className="slip-sign-label">{label}</span>
      {key && onSignaturesChange ? (
        <input
          className="slip-sign-value slip-sign-input"
          value={value}
          onChange={(e) => onSignaturesChange({ ...signatures, [key]: e.target.value })}
          aria-label={label}
          data-testid={`slip-sign-${key}`}
        />
      ) : (
        <span className="slip-sign-value">{value}</span>
      )}
    </div>
  )

  return (
    <>
      {pages.map((page, pi) => (
        <div className="slip-page" key={pi} data-testid="slip-page">
          <div className="slip-head">
            <span className="slip-title">RELEASE SLIP</span>
            <span>
              DATE: <b>{formatDate(date)}</b>
            </span>
            <span>
              {whoLabel} <b>{(whoEditable ? (signatures.who ?? crewName) : crewName) || "—"}</b>
            </span>
            <span>
              Page {pi + 1} of {pages.length}
            </span>
          </div>
          {page.blocks.length > 0 && (
            <table className="slip-table">
              <colgroup>
                <col style={{ width: "24mm" }} />
                <col style={{ width: "36mm" }} />
                <col style={{ width: "6mm" }} />
                <col style={{ width: "6mm" }} />
                <col style={{ width: "6mm" }} />
                <col style={{ width: "6mm" }} />
                <col style={{ width: "22mm" }} />
                <col style={{ width: "11mm" }} />
                <col style={{ width: "22mm" }} />
                <col style={{ width: "11mm" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2}>Order No.</th>
                  <th rowSpan={2}>Accnt. Name</th>
                  <th rowSpan={2}>F</th>
                  <th rowSpan={2}>R</th>
                  <th rowSpan={2}>S</th>
                  <th rowSpan={2}>O</th>
                  <th colSpan={2}>OUT</th>
                  <th colSpan={2}>IN</th>
                  <th rowSpan={2}>Notes</th>
                </tr>
                <tr>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>SKU</th>
                  <th>Qty</th>
                </tr>
              </thead>
              {page.blocks.map((b, bi) => {
                const box = typeBox(b.job.jobType)
                const job = b.job
                // A combined block: its summed lines are read-only; a line
                // typed after them is saved to the first order.
                const combined = !!job.combinedIds
                const summed = job.summedLines ?? 0
                const lineEditable = (line: number) => !combined || line >= summed
                const jobLine = (line: number) =>
                  !combined ? line : (job.lineMap?.[line] ?? (job.editOffset ?? 0) + (line - job.movements.length))
                const editLine = onEdit
                  ? (line: number, field: keyof SlipLineEdit) =>
                      lineEditable(line) ? (next: string) => onEdit(job.jobId, { lines: { [jobLine(line)]: { [field]: next } } }) : undefined
                  : undefined
                // Each line's type box (F / R / S / O): its own when one was
                // ticked on it, else the job's; a line with no item follows
                // the line above. A new group (another type) starts with a
                // ✓ and a thicker line above it.
                const lineTypes: (string | null)[] = []
                for (let i = 0; i < b.itemLines; i++) {
                  const mm = b.movements[i]
                  const prev = i > 0 ? lineTypes[i - 1] : box
                  lineTypes.push(mm?.slipType || (mm && (mm.qtyOut || mm.qtyIn) ? box : prev))
                }
                const groupStart = (i: number) => i === 0 || lineTypes[i] !== lineTypes[i - 1]
                return (
                  <tbody key={bi} className="slip-job" data-testid="slip-job">
                    {Array.from({ length: b.lines }, (_, li) => {
                      const collection = li >= b.itemLines ? b.collections[li - b.itemLines] : undefined
                      if (collection) {
                        return (
                          <tr key={li} className="slip-collect-line slip-group-start" data-testid="slip-collect-line">
                            {(["F", "R", "S", "O"] as const).map((k) => (
                              <td key={k} className="slip-box">
                                {k === typeBox(collection.jobType) ? "✓" : ""}
                              </td>
                            ))}
                            <td colSpan={4} className="slip-collect-label">
                              Collection
                            </td>
                            <td className="slip-note slip-note-job" title={collection.jobNote || undefined}>
                              <Editable
                                value={collection.jobNote ?? ""}
                                label="Collection notes"
                                onCommit={onEdit ? (next) => onEdit(collection.jobId, { jobNote: next }) : undefined}
                              />
                            </td>
                          </tr>
                        )
                      }
                      const m = b.movements[li]
                      // The job's collection note leads its first Notes cell
                      // (not repeated on a "(cont.)" block), before that
                      // line's own item note.
                      const jobNote = li === 0 && !b.continued ? b.job.jobNote : undefined
                      const note = [jobNote, m?.note].filter(Boolean).join(" · ")
                      const line = b.offset + li
                      const lineType = lineTypes[li] ?? null
                      const startsGroup = groupStart(li)
                      return (
                        <tr key={li} className={li > 0 && startsGroup ? "slip-group-start" : undefined} data-line-type={lineType ?? undefined}>
                          {li === 0 && (
                            <>
                              <td rowSpan={b.lines} className="slip-cell-top slip-order" data-testid={job.added ? "slip-added-job" : undefined}>
                                {job.added && onEdit && !b.continued ? (
                                  <>
                                    <Editable value={job.orderNo} label="Order No." onCommit={(next) => onEdit(job.jobId, { orderNo: next })} />
                                    {onRemoveJob && (
                                      <button type="button" className="slip-remove" onClick={() => onRemoveJob(job.jobId)} aria-label="Remove this order row" data-testid="slip-remove-job">
                                        ×
                                      </button>
                                    )}
                                  </>
                                ) : job.orderNos && job.orderNos.length > 1 ? (
                                  job.orderNos.map((o) => (
                                    <div key={o} data-testid="slip-combined-order">
                                      {o}
                                      {removeOrderButton(b, o, (job.combinedOrders ?? []).filter((c) => c.orderNo === o).map((c) => c.jobId))}
                                    </div>
                                  ))
                                ) : (
                                  <>
                                    {job.orderNo}
                                    {removeOrderButton(b, job.orderNo.trim(), [job.jobId])}
                                  </>
                                )}
                                {b.continued && <div className="slip-cont">(cont.)</div>}
                                {onEdit && (
                                  <button
                                    type="button"
                                    className="slip-add-line"
                                    onClick={() => setMinLines((s) => ({ ...s, [job.jobId]: b.offset + b.itemLines + 1 }))}
                                    data-testid="slip-add-line"
                                  >
                                    + Add line
                                  </button>
                                )}
                              </td>
                              <td rowSpan={b.lines} className="slip-cell-top">
                                <Editable
                                  value={b.job.accountName}
                                  multiline
                                  label="Accnt. Name"
                                  onCommit={onEdit && !b.continued && !combined ? (next) => onEdit(job.jobId, { accountName: next }) : undefined}
                                />
                              </td>
                            </>
                          )}
                          {/* … and give every line its own (see lineTypes). */}
                          {(["F", "R", "S", "O"] as const).map((k) => {
                            if (!typeBoxes) return <td key={k} className="slip-box" />
                            // An added row's first line: its order's type (click to tick, again to clear).
                            if (li === 0 && job.added && onEdit && !b.continued) {
                              return (
                                <td key={k} className="slip-box">
                                  <button
                                    type="button"
                                    className="slip-box-pick"
                                    aria-label={`Type ${k}`}
                                    aria-pressed={box === k}
                                    data-testid={`slip-box-${k}`}
                                    onClick={() => onEdit(job.jobId, { jobType: box === k ? MANUAL_JOB_TYPE : BOX_JOB_TYPE[k] })}
                                  >
                                    {box === k ? "✓" : ""}
                                  </button>
                                </td>
                              )
                            }
                            const on = lineType === k
                            const mark = on && startsGroup ? "✓" : ""
                            if (onEdit && lineEditable(line)) {
                              // On screen: tick this line's type (again to go back to the order's).
                              return (
                                <td key={k} className="slip-box">
                                  <button
                                    type="button"
                                    className={on && !startsGroup ? "slip-box-pick slip-box-faint" : "slip-box-pick"}
                                    aria-label={`Line type ${k}`}
                                    aria-pressed={on}
                                    data-testid={`slip-line-box-${k}`}
                                    onClick={() => onEdit(job.jobId, { lines: { [jobLine(line)]: { lineType: m?.slipType === k ? "" : k } } })}
                                  >
                                    {on ? "✓" : ""}
                                  </button>
                                </td>
                              )
                            }
                            return (
                              <td key={k} className="slip-box">
                                {mark}
                              </td>
                            )
                          })}
                          <td>
                            <SkuCell value={m && m.qtyOut ? itemName(m) : ""} label="OUT SKU" options={skuOptions} onCommit={editLine?.(line, "outSku")} />
                          </td>
                          <td className="slip-num">
                            <Editable value={m && m.qtyOut ? qty(m.qtyOut) : ""} label="OUT Qty" onCommit={editLine?.(line, "outQty")} />
                          </td>
                          <td>
                            <SkuCell value={m && m.qtyIn ? inItemName(m) : ""} label="IN SKU" options={skuOptions} onCommit={editLine?.(line, "inSku")} />
                          </td>
                          <td className="slip-num">
                            <Editable value={m && m.qtyIn ? qty(m.qtyIn) : ""} label="IN Qty" onCommit={editLine?.(line, "inQty")} />
                          </td>
                          <td className={jobNote ? "slip-note slip-note-job" : "slip-note"} title={note || undefined} data-testid={jobNote ? "slip-job-note" : undefined}>
                            <Editable
                              value={note}
                              label="Notes"
                              onCommit={
                                onEdit && lineEditable(line) && !(combined && jobNote !== undefined)
                                  ? (next) =>
                                      // The first line holds the job's collection note: an edit
                                      // there replaces it (and that line's own note).
                                      jobNote !== undefined
                                        ? onEdit(job.jobId, { jobNote: next, lines: { [jobLine(line)]: { note: "" } } })
                                        : onEdit(job.jobId, { lines: { [jobLine(line)]: { note: next } } })
                                  : undefined
                              }
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          )}
          {page.summary && (
            <div className="slip-bottom">
              <div className="slip-summary">
                <div className="slip-summary-title">Summary</div>
                <table className="slip-table" data-testid="slip-summary">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Out</th>
                      <th>In</th>
                      <th>Total Out</th>
                      <th>Total In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r?.sku ?? ""}</td>
                        <td className="slip-num">{r && r.out ? qty(r.out) : ""}</td>
                        <td className="slip-num">{r && r.in ? qty(r.in) : ""}</td>
                        {/* The net per SKU on its own side: more went out → Total Out, more came back → Total In. */}
                        <td className="slip-num">{r && r.out > r.in ? qty(r.out - r.in) : ""}</td>
                        <td className="slip-num">{r && r.in > r.out ? qty(r.in - r.out) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="slip-signs">
                {signature(whoLabel, whoEditable ? "who" : null, whoEditable ? (signatures.who ?? crewName) : crewName)}
                {signature("Checked By:", "checkedBy", signatures.checkedBy)}
                {signature("Noted By:", "notedBy", signatures.notedBy)}
                {signature("Approved By:", "approvedBy", signatures.approvedBy)}
              </div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

// Paper styles shared by the on-screen preview and the print copy. Explicit
// black/white (not theme colors), mm units for a true A4 page.
export const RELEASE_SLIP_CSS = `
.slip-page { width: 210mm; min-height: 297mm; padding: 8mm; box-sizing: border-box; background: #fff; color: #000; font: 9pt/1.2 Arial, Helvetica, sans-serif; display: flex; flex-direction: column; gap: 3mm; }
.slip-page *, .slip-page *::before, .slip-page *::after { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; font-size: 9pt; }
.slip-title { font-size: 12pt; font-weight: 700; letter-spacing: 0.04em; }
.slip-table { width: 100%; border-collapse: collapse; table-layout: fixed; color: #000; }
.slip-table th, .slip-table td { border: 0.3mm solid #000; height: 5.2mm; padding: 0 1.2mm; font-size: 8.5pt; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.slip-table th { font-weight: 600; text-align: center; height: 5mm; }
.slip-job tr:first-child td { border-top-width: 0.6mm; }
.slip-cell-top { vertical-align: top; padding-top: 1mm !important; white-space: normal !important; word-break: break-word; }
.slip-order { font-weight: 600; }
.slip-cont { font-weight: 400; font-size: 7.5pt; }
.slip-box { text-align: center; font-weight: 700; }
.slip-num { text-align: right; }
.slip-table td.slip-note { font-size: 7pt; }
.slip-table td.slip-note-job { white-space: normal; line-height: 1.05; font-weight: 600; text-overflow: clip; word-break: break-word; }
.slip-foot { font-size: 7.5pt; text-align: right; }
.slip-bottom { display: flex; gap: 6mm; align-items: flex-start; margin-top: 2mm; }
.slip-summary { flex: 0 0 92mm; }
.slip-summary-title { font-weight: 600; margin-bottom: 1mm; }
.slip-signs { flex: 1; display: flex; flex-direction: column; gap: 7mm; padding-top: 4mm; }
.slip-sign { display: flex; align-items: flex-end; gap: 3mm; }
.slip-sign-label { flex: 0 0 26mm; }
.slip-sign-value { flex: 1; border: 0; border-bottom: 0.3mm solid #000; min-height: 5mm; font: inherit; color: #000; background: transparent; padding: 0 1mm; }
.slip-sign-input:focus { outline: 1px dashed #888; }
.slip-edit { display: inline-block; min-width: 100%; min-height: 1em; outline: none; cursor: text; }
.slip-edit-block { display: block; }
.slip-edit:hover { box-shadow: inset 0 0 0 1px #9ca3af; }
.slip-edit:focus { box-shadow: inset 0 0 0 1px #2563eb; background: #eff6ff; white-space: normal; }
.slip-num .slip-edit { min-width: 0; width: calc(100% - 1.2ch); text-align: right; }
.slip-box-pick { all: unset; display: block; width: 100%; min-height: 4mm; cursor: pointer; text-align: center; font-weight: 700; }
.slip-box-pick:hover { box-shadow: inset 0 0 0 1px #9ca3af; }
.slip-remove { all: unset; cursor: pointer; float: right; font-weight: 400; padding: 0 0.5mm; line-height: 1; }
.slip-remove:hover { color: #b91c1c !important; }
.slip-sku-input { all: unset; display: block; width: 100%; min-height: 1em; cursor: text; font: inherit; color: #000; box-sizing: border-box; }
.slip-sku-input:hover { box-shadow: inset 0 0 0 1px #9ca3af; }
.slip-sku-input:focus { box-shadow: inset 0 0 0 1px #2563eb; background: #eff6ff; }
.slip-sku-menu { position: fixed; z-index: 1000; width: max-content; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; background: #fff; color: #111; border: 1px solid #d1d5db; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 12px/1.3 Arial, Helvetica, sans-serif; }
.slip-sku-option { display: flex; gap: 8px; padding: 6px 10px; min-height: 28px; align-items: center; cursor: pointer; white-space: nowrap; }
.slip-sku-option b { min-width: 44px; }
.slip-sku-option span { color: #4b5563; overflow: hidden; text-overflow: ellipsis; }
.slip-sku-option.is-active { background: #eff6ff; }
.slip-sku-empty { padding: 6px 10px; color: #6b7280; }
.slip-table tr.slip-group-start td { border-top-width: 0.6mm; }
.slip-box-faint { opacity: 0.35; }
.slip-table td.slip-collect-label { text-align: center; font-weight: 700; font-size: 7.5pt; letter-spacing: 0.06em; text-transform: uppercase; background: #f3f4f6; }
.slip-collect-line td { border-top-style: dashed; }
.slip-add-line { all: unset; display: block; margin-top: 1mm; font-size: 7pt; font-weight: 400; cursor: pointer; color: #2563eb !important; }
.slip-add-line:hover { text-decoration: underline; }
`
