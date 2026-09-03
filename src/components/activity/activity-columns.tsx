"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ColumnHeader } from "@/components/shared/column-header"
import { actionLabel, entityTypeLabel } from "@/lib/activity-log-config"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDateTime } from "@/lib/utils"
import type { ActivityLogEntry } from "@/lib/types"

function ActionCell({ entry }: { entry: ActivityLogEntry }) {
  const { t } = useTranslation("activity")
  return <>{`${actionLabel(entry.action, t)} ${entityTypeLabel(entry.entityType, t)}`}</>
}

function DetailsCell({
  entry,
  onViewDetails,
}: {
  entry: ActivityLogEntry
  onViewDetails: (entry: ActivityLogEntry) => void
}) {
  const { t } = useTranslation("activity")
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      title={t("viewFieldChanges")}
      onClick={(e) => {
        e.stopPropagation()
        onViewDetails(entry)
      }}
    >
      <History className="h-3.5 w-3.5" />
    </Button>
  )
}

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
      header: () => <ColumnHeader tKey="action" ns="activity" />,
      cell: ({ row }) => <ActionCell entry={row.original} />,
    },
    {
      id: "record",
      header: () => <ColumnHeader tKey="record" ns="activity" />,
      cell: ({ row }) => row.original.description || "—",
    },
    {
      accessorKey: "createdAt",
      header: () => <ColumnHeader tKey="dateTime" ns="activity" />,
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: "details",
      header: "",
      cell: ({ row }) => <DetailsCell entry={row.original} onViewDetails={onViewDetails} />,
    },
  ]
}
