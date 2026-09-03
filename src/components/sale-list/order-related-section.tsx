"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DashboardPlanPanel } from "@/components/dashboard/dashboard-plan-panel"
import type { ExportColumn } from "@/components/shared/export-buttons"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn } from "@/lib/utils"

function yearMonth(value: string) {
  return value.slice(0, 7)
}

// One order's related records (Filter Changes / Collections / Repairs) on the
// Sale List order-detail page — grouped by year-month with counts, matching
// the same treatment the standalone Filter Change list page already uses,
// just as a compact inline strip instead of a full sidebar so a few of these
// can be stacked on one page. Add/Expand come free from DashboardPlanPanel,
// the same shell already used for these record types elsewhere in the app.
export function OrderRelatedSection<TData extends { id: string; status?: string }>({
  title,
  icon,
  data,
  dateKey,
  columns,
  expandedColumns,
  exportColumns,
  exportFileName,
  emptyMessage,
  canAdd,
  onAdd,
  tableContainerClassName,
  tableClassName,
  headerAlwaysRow,
}: {
  title: string
  icon: LucideIcon
  data: TData[]
  // Field to group by year-month. Omit to skip the grouping strip entirely.
  dateKey?: keyof TData
  columns: ColumnDef<TData, unknown>[]
  expandedColumns?: ColumnDef<TData, unknown>[]
  exportColumns?: ExportColumn[]
  exportFileName?: string
  emptyMessage: string
  canAdd?: boolean
  onAdd?: () => void
  // Forwarded straight to DashboardPlanPanel — see its own comments.
  tableContainerClassName?: string
  tableClassName?: string
  headerAlwaysRow?: boolean
}) {
  const { t } = useTranslation("common")
  const [selectedMonth, setSelectedMonth] = React.useState<string>("all")

  const monthGroups = React.useMemo(() => {
    if (!dateKey) return []
    const counts = new Map<string, number>()
    for (const row of data) {
      const raw = row[dateKey]
      if (typeof raw !== "string" || !raw) continue
      const ym = yearMonth(raw)
      counts.set(ym, (counts.get(ym) ?? 0) + 1)
    }
    return Array.from(counts, ([month, count]) => ({ month, count })).sort((a, b) => b.month.localeCompare(a.month))
  }, [data, dateKey])

  const scopedData = React.useMemo(() => {
    if (!dateKey || selectedMonth === "all") return data
    return data.filter((row) => {
      const raw = row[dateKey]
      return typeof raw === "string" && yearMonth(raw) === selectedMonth
    })
  }, [data, dateKey, selectedMonth])

  return (
    <div className="space-y-2">
      {dateKey && monthGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedMonth("all")}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted/50",
              selectedMonth === "all" && "bg-accent font-medium"
            )}
          >
            {t("all")}
            <Badge variant="secondary">{data.length}</Badge>
          </button>
          {monthGroups.map((g) => (
            <button
              type="button"
              key={g.month}
              onClick={() => setSelectedMonth(g.month)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-muted/50",
                selectedMonth === g.month && "bg-accent font-medium"
              )}
            >
              {g.month}
              <Badge variant="secondary">{g.count}</Badge>
            </button>
          ))}
        </div>
      )}
      <DashboardPlanPanel
        title={title}
        icon={icon}
        columns={columns}
        expandedColumns={expandedColumns}
        data={scopedData}
        emptyMessage={emptyMessage}
        canAdd={canAdd}
        addLabel={t("add")}
        onAdd={onAdd}
        exportColumns={exportColumns}
        exportFileName={exportFileName}
        tableContainerClassName={tableContainerClassName}
        tableClassName={tableClassName}
        headerAlwaysRow={headerAlwaysRow}
      />
    </div>
  )
}
