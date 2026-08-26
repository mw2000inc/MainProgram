interface PrintTableOptions {
  title: string
  subtitle?: string
  columns: { header: string; key: string }[]
  rows: Record<string, unknown>[]
}

export function printTable({ title, subtitle, columns, rows }: PrintTableOptions) {
  const printWindow = window.open("", "_blank", "width=1000,height=800")
  if (!printWindow) return

  const tableRows = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c.key] ?? ""))}</td>`).join("")}</tr>`
    )
    .join("")

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0F172A; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          p.subtitle { font-size: 12px; color: #64748B; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #E2E8F0; padding: 6px 8px; text-align: left; }
          th { background: #0077B6; color: #fff; }
          tr:nth-child(even) { background: #F8FAFC; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
        <table>
          <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 300)
}

interface PrintFieldsAndTableOptions {
  title: string
  subtitle?: string
  fields: { label: string; value: string }[]
  tableTitle: string
  columns: { header: string; key: string }[]
  rows: Record<string, unknown>[]
}

// Same popup-window-then-window.print() approach as printTable() above, with
// a label/value field grid ahead of the table — for a profile-style printout
// (e.g. the Member detail panel) rather than a bare table export.
export function printFieldsAndTable({
  title,
  subtitle,
  fields,
  tableTitle,
  columns,
  rows,
}: PrintFieldsAndTableOptions) {
  const printWindow = window.open("", "_blank", "width=1000,height=800")
  if (!printWindow) return

  const fieldBlocks = fields
    .map(
      (f) =>
        `<div class="field"><p class="field-label">${escapeHtml(f.label)}</p><p class="field-value">${escapeHtml(f.value || "—")}</p></div>`
    )
    .join("")

  const tableRows = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c.key] ?? ""))}</td>`).join("")}</tr>`
    )
    .join("")

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0F172A; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          h2 { font-size: 14px; margin: 28px 0 12px; }
          p.subtitle { font-size: 12px; color: #64748B; margin: 0 0 20px; }
          .fields { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px 32px; }
          .field-label { font-size: 10px; color: #64748B; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 0.04em; }
          .field-value { font-size: 13px; margin: 0; font-weight: 600; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #E2E8F0; padding: 6px 8px; text-align: left; }
          th { background: #0077B6; color: #fff; }
          tr:nth-child(even) { background: #F8FAFC; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
        <div class="fields">${fieldBlocks}</div>
        <h2>${escapeHtml(tableTitle)}</h2>
        <table>
          <thead><tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 300)
}

// One resolved row of the Schedule page's Table View — already joined/
// soft-matched (customer lookup, filter_change_plans/collections/
// sale_list_entries matched by order number) by the caller, so this file
// stays a pure rendering/printing utility with no data-fetching knowledge.
export interface ScheduleTableRow {
  time: string
  contactPerson: string
  contactNo: string
  orderNumber: string
  memberAcctName: string
  address: string
  itemOut: string
  technician: string
  collection: string
  description: string
  unitModel: string
  // A second location for this same job (e.g. pull-out vs install address —
  // see ScheduleJob.secondaryAddress) — rendered as an extra row right below
  // this one, with every other column blank/merged, when set.
  secondaryAddress?: string
}

const SCHEDULE_TABLE_COLUMNS = [
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
]

// Same popup-window-then-window.print() approach as printTable() above, but
// with each row optionally followed by a second, mostly-blank row carrying
// just the secondary address — spanning everything up through Address on
// one side and everything after it on the other, so it reads as a single
// continuation line rather than a full row of empty cells.
export function printScheduleTable({ title, subtitle, rows }: { title: string; subtitle?: string; rows: ScheduleTableRow[] }) {
  const printWindow = window.open("", "_blank", "width=1200,height=800")
  if (!printWindow) return

  const tableRows = rows
    .map((row) => {
      const mainRow = `<tr>
        <td>${escapeHtml(row.time || "—")}</td>
        <td>${escapeHtml(row.contactPerson || "—")}</td>
        <td>${escapeHtml(row.contactNo || "—")}</td>
        <td>${escapeHtml(row.orderNumber || "—")}</td>
        <td>${escapeHtml(row.memberAcctName || "—")}</td>
        <td>${escapeHtml(row.address || "—")}</td>
        <td>${escapeHtml(row.itemOut || "—")}</td>
        <td>${escapeHtml(row.technician || "—")}</td>
        <td>${escapeHtml(row.collection || "—")}</td>
        <td>${escapeHtml(row.description || "—")}</td>
        <td>${escapeHtml(row.unitModel || "—")}</td>
      </tr>`
      if (!row.secondaryAddress) return mainRow
      const secondaryRow = `<tr class="secondary">
        <td colspan="5"></td>
        <td>${escapeHtml(row.secondaryAddress)}</td>
        <td colspan="5"></td>
      </tr>`
      return mainRow + secondaryRow
    })
    .join("")

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0F172A; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          p.subtitle { font-size: 12px; color: #64748B; margin: 0 0 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th, td { border: 1px solid #E2E8F0; padding: 5px 6px; text-align: left; }
          th { background: #0077B6; color: #fff; }
          tr.secondary td { background: #F8FAFC; font-style: italic; color: #64748B; border-top: none; }
          @media print {
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}
        <table>
          <thead><tr>${SCHEDULE_TABLE_COLUMNS.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  setTimeout(() => {
    printWindow.print()
  }, 300)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
