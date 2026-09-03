"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlanStatusBadge } from "@/components/shared/status-badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { TranslatableText } from "@/components/shared/translatable-text"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate } from "@/lib/utils"
import type { ScheduleJob, ScheduleJobType } from "@/lib/types"

function NotesCell({ job }: { job: ScheduleJob }) {
  if (!job.notes) return <span className="text-muted-foreground">—</span>
  return (
    <TranslatableText entityType="schedule_jobs" entityId={job.id} fieldName="notes" text={job.notes} className="text-muted-foreground" />
  )
}

function RemarksCell({ job }: { job: ScheduleJob }) {
  if (!job.remarks) return <span className="text-muted-foreground">—</span>
  return (
    <TranslatableText entityType="schedule_jobs" entityId={job.id} fieldName="remarks" text={job.remarks} className="text-muted-foreground" />
  )
}

// Print/export and formatTechnicians' own default stay in English regardless
// of interface language — deferred to the long-tail phase alongside the
// other modules' export column arrays (see the phased i18n plan). The
// visible table itself renders each type via JobTypeCell below instead,
// using schedule.json (whose keys match these same enum values).
export const JOB_TYPE_LABELS: Record<ScheduleJobType, string> = {
  installation: "Installation",
  filter_change: "Filter Change",
  repair: "Repair",
  collection: "Collection",
  monitoring: "Monitoring",
  other: "Other",
}

export const SCHEDULE_EXPORT_COLUMNS = [
  { header: "Date", key: "scheduledDate" },
  { header: "Job Type", key: "jobType" },
  { header: "Technician", key: "technician" },
  { header: "Order No", key: "orderNo" },
  { header: "Status", key: "status" },
  { header: "Notes", key: "notes" },
  { header: "Remarks", key: "remarks" },
]

// Combines the primary + optional second technician into one display string
// ("Eubert and Jerson") — used everywhere a job's technician is shown, so a
// two-technician job always reads the same way. `andWord` defaults to the
// English word so print/export call sites (which can't call hooks) keep
// working unchanged — a live-rendered call site passes the translated word
// instead (see JobTypeCell's sibling usage in schedule-agenda.tsx etc.).
export function formatTechnicians(technician: string, technician2?: string, andWord = "and"): string {
  return technician2 ? `${technician} ${andWord} ${technician2}` : technician
}

function JobTypeCell({ jobType }: { jobType: ScheduleJobType }) {
  const { t } = useTranslation("schedule")
  return <>{t(jobType)}</>
}

function TechnicianCell({ technician, technician2 }: { technician: string; technician2?: string }) {
  const { t } = useTranslation("schedule")
  return <>{formatTechnicians(technician, technician2, t("and"))}</>
}

function DeleteCell({ job, onDelete }: { job: ScheduleJob; onDelete: (job: ScheduleJob) => void }) {
  const { t } = useTranslation("common")
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-danger hover:text-danger"
      title={t("delete")}
      onClick={() => onDelete(job)}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
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
      header: () => <ColumnHeader tKey="date" ns="schedule" />,
      cell: ({ row }) => formatDate(row.original.scheduledDate),
    },
    {
      accessorKey: "jobType",
      header: () => <ColumnHeader tKey="jobType" ns="schedule" />,
      cell: ({ row }) => <JobTypeCell jobType={row.original.jobType} />,
    },
    {
      accessorKey: "technician",
      header: () => <ColumnHeader tKey="technician" ns="schedule" />,
      cell: ({ row }) => <TechnicianCell technician={row.original.technician} technician2={row.original.technician2} />,
    },
    {
      accessorKey: "orderNo",
      header: () => <ColumnHeader tKey="orderNo" ns="fields" />,
      cell: ({ row }) => row.original.orderNo || "—",
    },
    {
      accessorKey: "status",
      header: () => <ColumnHeader tKey="status" ns="fields" />,
      cell: ({ row }) => <PlanStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "notes",
      header: () => <ColumnHeader tKey="note" ns="fields" />,
      cell: ({ row }) => <NotesCell job={row.original} />,
    },
    {
      accessorKey: "remarks",
      header: () => <ColumnHeader tKey="remarks" ns="schedule" />,
      cell: ({ row }) => <RemarksCell job={row.original} />,
    },
    ...(canDelete
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: ScheduleJob } }) => (
              <DeleteCell job={row.original} onDelete={onDelete} />
            ),
          } satisfies ColumnDef<ScheduleJob, unknown>,
        ]
      : []),
  ]
}
