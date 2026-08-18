"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { formatDate } from "@/lib/utils"
import type { ScheduleJob, ScheduleJobType } from "@/lib/types"

export const JOB_TYPE_LABELS: Record<ScheduleJobType, string> = {
  installation: "Installation",
  filter_change: "Filter Change",
  repair: "Repair",
  collection: "Collection",
  monitoring: "Monitoring",
  other: "Other",
}

export function getScheduleColumns({
  canDelete,
  onDelete,
}: {
  canDelete: boolean
  onDelete: (job: ScheduleJob) => void
}): ColumnDef<ScheduleJob, unknown>[] {
  return [
    {
      accessorKey: "scheduledDate",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.scheduledDate),
    },
    {
      accessorKey: "jobType",
      header: "Job Type",
      cell: ({ row }) => JOB_TYPE_LABELS[row.original.jobType],
    },
    {
      accessorKey: "technician",
      header: "Technician",
    },
    {
      accessorKey: "orderNo",
      header: "Order No",
      cell: ({ row }) => row.original.orderNo || "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "notes",
      header: "Notes",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.notes || "—"}</span>
      ),
    },
    {
      accessorKey: "remarks",
      header: "Remarks",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.remarks || "—"}</span>
      ),
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: ScheduleJob } }) => (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-danger hover:text-danger"
                onClick={() => onDelete(row.original)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ),
          } satisfies ColumnDef<ScheduleJob, unknown>,
        ]
      : []),
  ]
}
