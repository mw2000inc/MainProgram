"use client"

import * as React from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DataTable } from "@/components/data-table/data-table"
import { formatTechnicians } from "@/components/schedule/schedule-columns"
import { useTechnicianWorkload } from "@/lib/hooks/use-technician-workload"
import {
  ALL_TECHNICIANS,
  workloadPeriodLabels,
  workloadRecordsFor,
  type WorkloadPeriod,
  type WorkloadRecord,
} from "@/lib/technician-workload"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDate } from "@/lib/utils"

// Every job behind the Schedule toolbar's "This week" / "This month" counts,
// for the technician picked in the toolbar (or everyone). Built from the same
// records as the counts (workloadRecordsFor), so the list always adds up to
// the badge.
export function TechnicianActivityHistoryDialog({
  open,
  onOpenChange,
  technician,
  period,
  onPeriodChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // "all" for every technician.
  technician: string
  period: WorkloadPeriod
  onPeriodChange: (period: WorkloadPeriod) => void
}) {
  const { t } = useTranslation("schedule")
  const { records } = useTechnicianWorkload()
  const isAll = technician === "all"
  const rows = React.useMemo(
    () => workloadRecordsFor(records, isAll ? ALL_TECHNICIANS : technician, period),
    [records, isAll, technician, period]
  )
  const done = rows.filter((r) => r.completed).length
  const labels = workloadPeriodLabels()

  const columns = React.useMemo<ColumnDef<WorkloadRecord, unknown>[]>(
    () => [
      {
        accessorKey: "date",
        header: t("date"),
        cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
      },
      {
        accessorKey: "status",
        header: t("historyStatus"),
        cell: ({ row }) => {
          const r = row.original
          return r.completed ? (
            <div className="whitespace-nowrap">
              <Badge variant="outline" className="border-success/40 text-success">
                {t("historyCompleted")}
              </Badge>
              {r.completedDate && <div className="mt-0.5 text-[11px] text-muted-foreground">{t("historyAccomplished", { date: formatDate(r.completedDate) })}</div>}
            </div>
          ) : (
            <Badge variant="outline">{r.status || t("historyPending")}</Badge>
          )
        },
      },
      {
        id: "jobType",
        accessorFn: (r) => (r.jobType === "other" ? t("customErrandType") : t(r.jobType)),
        header: t("jobType"),
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() as string}</span>,
      },
      {
        id: "customer",
        accessorFn: (r) => `${r.customerName} ${r.orderNo}`,
        header: t("historyCustomer"),
        cell: ({ row }) => (
          <div className="w-[170px] whitespace-normal">
            <div className="font-medium">{row.original.customerName || "—"}</div>
            {row.original.orderNo && <div className="text-[11px] text-muted-foreground">{row.original.orderNo}</div>}
          </div>
        ),
      },
      {
        accessorKey: "address",
        header: t("editAddress"),
        cell: ({ row }) => <div className="w-[220px] whitespace-normal text-xs wrap-break-word">{row.original.address || "—"}</div>,
      },
      {
        id: "technicians",
        accessorFn: (r) => formatTechnicians(r.technician, r.technician2 ?? "", "&"),
        header: t("editTechnicians"),
        cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() as string}</span>,
      },
      {
        id: "details",
        accessorFn: (r) => `${r.filterCodes} ${r.notes}`,
        header: t("historyDetails"),
        cell: ({ row }) => (
          <div className="w-[260px] space-y-0.5 whitespace-normal text-xs">
            {row.original.filterCodes && (
              <div>
                {t("editFilters")}: <span className="font-medium">{row.original.filterCodes}</span>
              </div>
            )}
            {row.original.notes && <div className="whitespace-pre-line wrap-break-word text-muted-foreground">{row.original.notes}</div>}
            {!row.original.filterCodes && !row.original.notes && "—"}
          </div>
        ),
      },
    ],
    [t]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("historyTitle")}</DialogTitle>
          <DialogDescription data-testid="history-summary">
            {t("historySummary", {
              who: isAll ? t("allTechnicians") : technician,
              period: period === "week" ? labels.week : labels.month,
              done: String(done),
              assigned: String(rows.length),
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-1.5">
          {(["week", "month"] as WorkloadPeriod[]).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={p === period ? "default" : "outline"}
              className={cn("h-8")}
              onClick={() => onPeriodChange(p)}
            >
              {p === "week" ? t("workloadThisWeek").replace(/:$/, "") : t("workloadThisMonth").replace(/:$/, "")}
            </Button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="history-table">
          <DataTable columns={columns} data={rows} pageSize={50} pageResetKey={`${technician}-${period}`} searchPlaceholder={t("historySearch")} emptyMessage={t("historyEmpty")} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
