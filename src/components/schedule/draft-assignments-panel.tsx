"use client"

import * as React from "react"
import { Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { InlineTechnicianPairCell } from "@/components/shared/technician-combobox"
import { pairPatchToFields } from "@/lib/technicians"
import {
  useDraftAssignments,
  useGenerateDraftAssignments,
  useApproveDraftAssignments,
  useRejectDraftAssignments,
} from "@/lib/hooks/use-schedule-draft-assignments"
import type { DraftAssignment, DraftEntityType } from "@/lib/hooks/use-schedule-draft-assignments"
import { useFilterChangePlans } from "@/lib/hooks/use-filter-change-plans"
import { useCollections } from "@/lib/hooks/use-collections"
import { useRepairPlans } from "@/lib/hooks/use-repair-plans"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { todayIso } from "@/lib/utils"

const ENTITY_TYPE_LABEL: Record<DraftEntityType, string> = {
  filter_change_plans: "Filter Change",
  collections: "Collection",
  repair_plans: "Repair",
}

// Looks up the human-readable "Order # — Account Name" label for a draft
// row from the same, already-fetched plan lists Filter Change/Collection/
// Repair's own pages read — no denormalized label column on
// schedule_draft_assignments itself, since this data already exists and
// is already cached.
function useEntityLabel(draft: DraftAssignment): string {
  const { data: filterChangePlans = [] } = useFilterChangePlans()
  const { data: collections = [] } = useCollections()
  const { data: repairPlans = [] } = useRepairPlans()
  if (draft.entityType === "filter_change_plans") {
    const plan = filterChangePlans.find((p) => p.id === draft.entityId)
    return plan ? `${plan.orderNumber} — ${plan.memberAccount}` : draft.entityId
  }
  if (draft.entityType === "collections") {
    const entry = collections.find((c) => c.id === draft.entityId)
    return entry ? `${entry.orderNo} — ${entry.accountName}` : draft.entityId
  }
  const plan = repairPlans.find((r) => r.id === draft.entityId)
  return plan ? `${plan.orderNo} — ${plan.accountName}` : draft.entityId
}

function DraftRow({
  draft,
  override,
  onOverrideChange,
  onReject,
  rejecting,
}: {
  draft: DraftAssignment
  override: { technician: string; technician2: string }
  onOverrideChange: (next: { technician: string; technician2: string }) => void
  onReject: () => void
  rejecting: boolean
}) {
  const label = useEntityLabel(draft)
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{ENTITY_TYPE_LABEL[draft.entityType]}</Badge>
          <span className="font-medium">{label}</span>
          {draft.outsideCoverage && (
            <Badge variant="outline" className="text-amber-600 border-amber-600/40">
              Outside usual coverage
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{draft.explanation}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <InlineTechnicianPairCell
          primary={override.technician}
          secondary={override.technician2}
          onCommit={(patch) => {
            const fields = pairPatchToFields(patch, { primary: "technician", secondary: "technician2" })
            onOverrideChange({ technician: fields.technician ?? override.technician, technician2: fields.technician2 ?? override.technician2 })
          }}
        />
        <Button type="button" variant="ghost" size="icon-sm" onClick={onReject} disabled={rejecting} aria-label="Reject">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// The Schedule page's "Draft Assignments" tab — a batch, date-scoped
// counterpart to the toolbar's own "Auto-suggest technicians" (which works
// on schedule_jobs rows an admin already created). This instead starts from
// Filter Change/Collection/Repair records due on a date that don't have a
// real technician yet, clusters them into proposals an admin reviews/edits
// here, and only writes anything back to those tables on explicit approval.
// Deliberately its own tab, not folded into the existing "Daily Report
// Approvals" (PendingApprovalsPanel) — that dialog already means something
// else entirely (customer dispatch-confirmation approval), unrelated to
// technician assignment.
export function DraftAssignmentsPanel() {
  const { t } = useTranslation("schedule")
  const [targetDate, setTargetDate] = React.useState(todayIso())
  const { data: drafts = [], isPending } = useDraftAssignments(targetDate)
  const generate = useGenerateDraftAssignments()
  const approve = useApproveDraftAssignments(targetDate)
  const reject = useRejectDraftAssignments(targetDate)
  // Only ever holds an entry once the admin actually edits a row — every
  // read falls back to the draft's own proposed values (see the JSX below
  // and handleApproveAll), so there's no need to pre-seed or prune this as
  // `drafts` changes.
  const [overrides, setOverrides] = React.useState<Record<string, { technician: string; technician2: string }>>({})

  async function handleApproveAll() {
    await approve.mutateAsync(
      drafts.map((d) => ({
        id: d.id,
        entityType: d.entityType,
        entityId: d.entityId,
        technician: overrides[d.id]?.technician ?? d.proposedTechnician,
        technician2: overrides[d.id]?.technician2 ?? d.proposedTechnician2,
      }))
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="draft-target-date" className="text-xs text-muted-foreground">
              {t("date")}
            </label>
            <Input id="draft-target-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="h-9 w-40" />
          </div>
          <Button type="button" variant="outline" className="gap-1.5" onClick={() => generate.mutate(targetDate)} disabled={generate.isPending}>
            <Sparkles className="h-4 w-4" /> {generate.isPending ? "Generating..." : "Generate"}
          </Button>
          {drafts.length > 0 && (
            <Button type="button" className="gap-1.5" onClick={handleApproveAll} disabled={approve.isPending}>
              {approve.isPending ? "Approving..." : `Approve All (${drafts.length})`}
            </Button>
          )}
        </div>

        {isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>
        ) : drafts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No draft assignments for this date yet — pick a date and click Generate.
          </p>
        ) : (
          <div className="space-y-2">
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                override={overrides[d.id] ?? { technician: d.proposedTechnician, technician2: d.proposedTechnician2 }}
                onOverrideChange={(next) => setOverrides((prev) => ({ ...prev, [d.id]: next }))}
                onReject={() => reject.mutate([d.id])}
                rejecting={reject.isPending}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
