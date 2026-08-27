"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { actionLabel, entityTypeLabel } from "@/lib/activity-log-config"
import { formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

export function getActivityColumns(actorLabel: string): ColumnDef<ActivityLogEntry, unknown>[] {
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
  ]
}
