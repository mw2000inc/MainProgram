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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
