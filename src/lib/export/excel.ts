import * as XLSX from "xlsx"

export function exportToExcel(
  rows: Record<string, unknown>[],
  fileName: string,
  sheetName = "Sheet1"
) {
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
}

// Several sheets in one workbook (e.g. the Daily Report: a summary plus one
// sheet per section). Empty sheets keep their headers when `headers` is set.
export function exportWorkbook(sheets: { name: string; rows: Record<string, unknown>[]; headers?: string[] }[], fileName: string) {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(sheet.rows, sheet.headers ? { header: sheet.headers } : undefined)
    if (sheet.rows.length === 0 && sheet.headers) XLSX.utils.sheet_add_aoa(worksheet, [sheet.headers])
    // Excel caps sheet names at 31 characters.
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31))
  }
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
}
