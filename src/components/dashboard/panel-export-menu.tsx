"use client"

import { Download, FileSpreadsheet, FileType } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { exportToExcel } from "@/lib/export/excel"
import { exportToCsv } from "@/lib/export/csv"
import type { ExportColumn } from "@/components/shared/export-buttons"

export function PanelExportMenu<T extends object>({
  columns,
  rows,
  fileName,
}: {
  columns: ExportColumn[]
  rows: T[]
  fileName: string
}) {
  const asRecords = () => {
    const records = rows as unknown as Record<string, unknown>[]
    return records.map((row) => Object.fromEntries(columns.map((c) => [c.header, row[c.key] ?? ""])))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Export">
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => exportToCsv(asRecords(), fileName)}>
          <FileType className="h-4 w-4 text-primary" />
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportToExcel(asRecords(), fileName)}>
          <FileSpreadsheet className="h-4 w-4 text-success" />
          Export Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
