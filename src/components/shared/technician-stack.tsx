import { normalizeTechnicianPair } from "@/lib/technicians"

// A job's / record's technicians, one under the other — the same stacked look
// as the editable Serviceman cell, for read-only cells. "—" when unassigned.
export function TechnicianStack({ primary, secondary }: { primary?: string | null; secondary?: string | null }) {
  const pair = normalizeTechnicianPair(primary ?? "", secondary ?? "")
  if (!pair.primary) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex min-w-37.5 flex-col gap-0.5" data-testid="technician-stack">
      <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">{pair.primary}</span>
      {pair.secondary && <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-xs">{pair.secondary}</span>}
    </span>
  )
}
