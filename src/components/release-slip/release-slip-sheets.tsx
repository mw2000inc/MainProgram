"use client"

import * as React from "react"
import type { ReleaseSlipJob, ReleaseSlipMovement } from "@/lib/api/release-slip"
import { formatDate } from "@/lib/utils"

// The printed Release Slip, laid out like the paper form: A4 portrait, black
// on white whatever the app theme, 4 jobs per page. Labels stay in English,
// like the app's other printed forms.
//
// Every job block has at least LINES_PER_JOB item lines (blank ones are left
// for handwriting). A page holds up to 4 jobs and LINES_PER_PAGE item lines;
// a job with more items gets a taller block and the jobs after it move to the
// next page; a job longer than a whole page continues on the next page
// "(cont.)". The Summary and the signature lines go on the last page, or on a
// page of their own when they don't fit under the last jobs.

export const LINES_PER_JOB = 8
const JOBS_PER_PAGE = 4
const LINES_PER_PAGE = JOBS_PER_PAGE * LINES_PER_JOB
// Room on one page for item lines + the Summary block, in line heights.
const PAGE_CAPACITY = 46
const MIN_SUMMARY_ROWS = 10

type Block = { job: ReleaseSlipJob; movements: ReleaseSlipMovement[]; lines: number; continued: boolean }
type Page = { blocks: Block[]; summary: boolean }

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

export function buildSummary(jobs: ReleaseSlipJob[]) {
  const map = new Map<string, { sku: string; out: number; in: number; pending: boolean }>()
  for (const j of jobs)
    for (const m of j.movements) {
      if (m.errand || !(m.qtyOut || m.qtyIn)) continue
      const key = itemName(m)
      const row = map.get(key) ?? { sku: key, out: 0, in: 0, pending: false }
      row.out += m.qtyOut
      row.in += m.qtyIn
      if (m.status === "pending") row.pending = true
      map.set(key, row)
    }
  return [...map.values()].sort((a, b) => a.sku.localeCompare(b.sku))
}

export function paginate(jobs: ReleaseSlipJob[], summaryRows: number): Page[] {
  // Split a job longer than a whole page into page-sized chunks.
  const blocks: Block[] = []
  for (const job of jobs) {
    const items = job.movements.filter((m) => m.qtyOut || m.qtyIn || m.note)
    if (items.length <= LINES_PER_PAGE) {
      blocks.push({ job, movements: items, lines: Math.max(LINES_PER_JOB, items.length), continued: false })
    } else {
      for (let i = 0; i < items.length; i += LINES_PER_PAGE) {
        const chunk = items.slice(i, i + LINES_PER_PAGE)
        blocks.push({ job, movements: chunk, lines: Math.max(LINES_PER_JOB, chunk.length), continued: i > 0 })
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
  const summaryLines = 2 + Math.max(MIN_SUMMARY_ROWS, summaryRows)
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
}

export function ReleaseSlipSheets({
  date,
  technicianName,
  jobs,
  signatures,
  onSignaturesChange,
}: {
  date: string
  technicianName: string
  jobs: ReleaseSlipJob[]
  signatures: SlipSignatures
  // Given on the on-screen copy: the three names are editable boxes there.
  // The print copy shows them as plain text.
  onSignaturesChange?: (next: SlipSignatures) => void
}) {
  const summary = React.useMemo(() => buildSummary(jobs), [jobs])
  const pages = React.useMemo(() => paginate(jobs, summary.length), [jobs, summary.length])
  const anyPending = jobs.some((j) => j.movements.some((m) => m.status === "pending"))
  const summaryRows = [...summary, ...Array.from({ length: Math.max(0, MIN_SUMMARY_ROWS - summary.length) }, () => null)]

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
              Technician: <b>{technicianName || "—"}</b>
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
                return (
                  <tbody key={bi} className="slip-job" data-testid="slip-job">
                    {Array.from({ length: b.lines }, (_, li) => {
                      const m = b.movements[li]
                      return (
                        <tr key={li}>
                          {li === 0 && (
                            <>
                              <td rowSpan={b.lines} className="slip-cell-top slip-order">
                                {b.job.orderNo}
                                {b.continued && <div className="slip-cont">(cont.)</div>}
                              </td>
                              <td rowSpan={b.lines} className="slip-cell-top">
                                {b.job.accountName}
                              </td>
                              {(["F", "R", "S", "O"] as const).map((k) => (
                                <td key={k} rowSpan={b.lines} className="slip-cell-top slip-box">
                                  {box === k ? "✓" : ""}
                                </td>
                              ))}
                            </>
                          )}
                          <td>{m && m.qtyOut ? itemName(m) : ""}</td>
                          <td className="slip-num">{m && m.qtyOut ? `${qty(m.qtyOut)}${m.status === "pending" ? "*" : ""}` : ""}</td>
                          <td>{m && m.qtyIn ? itemName(m) : ""}</td>
                          <td className="slip-num">{m && m.qtyIn ? `${qty(m.qtyIn)}${m.status === "pending" ? "*" : ""}` : ""}</td>
                          <td className="slip-note" title={m?.note}>
                            {m?.note ?? ""}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}
            </table>
          )}
          {anyPending && page.blocks.length > 0 && <div className="slip-foot">* awaiting inventory approval</div>}
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
                    </tr>
                  </thead>
                  <tbody>
                    {summaryRows.map((r, i) => (
                      <tr key={i}>
                        <td>{r?.sku ?? ""}</td>
                        <td className="slip-num">{r && r.out ? `${qty(r.out)}${r.pending ? "*" : ""}` : ""}</td>
                        <td className="slip-num">{r && r.in ? qty(r.in) : ""}</td>
                        <td className="slip-num">{r ? `${qty(r.out - r.in)}${r.pending ? "*" : ""}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="slip-signs">
                {signature("Technician:", null, technicianName)}
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
.slip-table th, .slip-table td { border: 0.3mm solid #000; height: 5.6mm; padding: 0 1.2mm; font-size: 8.5pt; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.slip-table th { font-weight: 600; text-align: center; height: 5mm; }
.slip-job tr:first-child td { border-top-width: 0.6mm; }
.slip-cell-top { vertical-align: top; padding-top: 1mm !important; white-space: normal !important; word-break: break-word; }
.slip-order { font-weight: 600; }
.slip-cont { font-weight: 400; font-size: 7.5pt; }
.slip-box { text-align: center; font-weight: 700; }
.slip-num { text-align: right; }
.slip-table td.slip-note { font-size: 7pt; }
.slip-foot { font-size: 7.5pt; text-align: right; }
.slip-bottom { display: flex; gap: 6mm; align-items: flex-start; margin-top: 2mm; }
.slip-summary { flex: 0 0 92mm; }
.slip-summary-title { font-weight: 600; margin-bottom: 1mm; }
.slip-signs { flex: 1; display: flex; flex-direction: column; gap: 9mm; padding-top: 8mm; }
.slip-sign { display: flex; align-items: flex-end; gap: 3mm; }
.slip-sign-label { flex: 0 0 26mm; }
.slip-sign-value { flex: 1; border: 0; border-bottom: 0.3mm solid #000; min-height: 5mm; font: inherit; color: #000; background: transparent; padding: 0 1mm; }
.slip-sign-input:focus { outline: 1px dashed #888; }
`
