"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { actionLabel, entityTypeLabel } from "@/lib/activity-log-config"
import { formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

// The row itself now navigates to the record (see ActivityLogView's
// onRowClick) — this button is the only way left to see the before/after
// field diff, so it's kept as an explicit action rather than dropped.
export function getActivityColumns(
  actorLabel: string,
  onViewDetails: (entry: ActivityLogEntry) => void
): ColumnDef<ActivityLogEntry, unknown>[] {
  return [
    {
      accessorKey: "userName",
      header: actorLabel,
      cell: ({ row }) => <span className="font-medium">{row.original.userName}</span>,
    },
    {
      id: "action",
      header: "Action",
      cell: ({ row }) => `${actionLabel(row.original.action)} ${entityTypeLabel(row.original.entityType)}`,
    },
    {
      id: "record",
      header: "Record",
      cell: ({ row }) => row.original.description || "—",
    },
    {
      accessorKey: "createdAt",
      header: "Date & Time",
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: "details",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="View field changes"
          onClick={(e) => {
            e.stopPropagation()
            onViewDetails(row.original)
          }}
        >
          <History className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ]
}
