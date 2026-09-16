"use client"

import * as React from "react"
import { Maximize2, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useProducts } from "@/lib/hooks/use-inventory"
import { useCreateRepairPlanPart, useDeleteRepairPlanPart, useRepairPlanParts } from "@/lib/hooks/use-repair-plan-parts"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { RepairPlanPart } from "@/lib/types"

function PartsTable({
  parts,
  canEdit,
  onDelete,
}: {
  parts: RepairPlanPart[]
  canEdit: boolean
  onDelete: (part: RepairPlanPart) => void
}) {
  const { t } = useTranslation("repair")
  const { t: tFields } = useTranslation("fields")

  if (parts.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("noPartsFound")}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tFields("partNo")}</TableHead>
          <TableHead>{t("part")}</TableHead>
          <TableHead>{t("inOut")}</TableHead>
          <TableHead>{tFields("quantity")}</TableHead>
          {canEdit && <TableHead className="w-8" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {parts.map((part) => (
          <TableRow key={part.id}>
            <TableCell className="font-medium">{part.productSku || "—"}</TableCell>
            <TableCell className="text-muted-foreground">{part.productName || "—"}</TableCell>
            <TableCell>{part.inOut}</TableCell>
            <TableCell>{part.quantity}</TableCell>
            {canEdit && (
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-danger hover:text-danger"
                  onClick={() => onDelete(part)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function AddPartDialog({
  open,
  onOpenChange,
  repairPlanId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repairPlanId: string
}) {
  const { t } = useTranslation("repair")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: products = [] } = useProducts()
  const createPart = useCreateRepairPlanPart()
  const [partText, setPartText] = React.useState("")
  const [partNoText, setPartNoText] = React.useState("")
  const [inOutText, setInOutText] = React.useState("IN")
  const [quantity, setQuantity] = React.useState("1")

  // Every field below is a typable Combobox (free text + filtered
  // suggestions), not a click-only native Select — but productId and
  // in_out are still real, constrained values underneath (a foreign key
  // into products, and a DB check(in_out in ('IN','OUT')) respectively),
  // so submission only ever fires once the typed text resolves to exactly
  // one of those real values; canSubmit below is what enforces that.
  const formatPart = React.useCallback((p: (typeof products)[number]) => `${p.sku} — ${p.name}`, [])
  const partOptions: ComboboxOption[] = React.useMemo(() => products.map((p) => ({ value: formatPart(p) })), [
    products,
    formatPart,
  ])
  const partNoOptions: ComboboxOption[] = React.useMemo(() => products.map((p) => ({ value: p.sku })), [products])
  const inOutOptions: ComboboxOption[] = React.useMemo(() => [{ value: "IN" }, { value: "OUT" }], [])

  // Part and Part No are two independent, clickable entry points into the
  // SAME product catalog — picking one auto-fills the other so they can
  // never drift out of sync, both ultimately resolving to one real
  // products row (there's no such thing as a Part No without a Part, or
  // vice versa; repair_plan_parts.product_id is a single FK).
  function handlePartChange(value: string) {
    setPartText(value)
    const match = products.find((p) => formatPart(p) === value)
    if (match) setPartNoText(match.sku)
  }

  function handlePartNoChange(value: string) {
    setPartNoText(value)
    const match = products.find((p) => p.sku === value)
    if (match) setPartText(formatPart(match))
  }

  const selectedProduct = products.find((p) => formatPart(p) === partText && p.sku === partNoText)
  const resolvedInOut = inOutText.trim().toUpperCase()
  const canSubmit = !!selectedProduct && (resolvedInOut === "IN" || resolvedInOut === "OUT") && Number(quantity) > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addPart")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("part")}</label>
            {/* Part No shown alongside the name in every suggestion so a
                part can be found by typing its code, not just its (often
                long) description — matches the table's own Part No/Part
                split below. */}
            <Combobox value={partText} onChange={handlePartChange} options={partOptions} placeholder={t("selectProduct")} />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{tFields("partNo")}</label>
            {/* Independently typable/clickable, same as Part above — picking
                a suggestion here (or in Part) auto-fills the other field via
                handlePartNoChange/handlePartChange, so they always describe
                the same product. */}
            <Combobox
              value={partNoText}
              onChange={handlePartNoChange}
              options={partNoOptions}
              placeholder={t("selectProduct")}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("inOut")}</label>
              <Combobox value={inOutText} onChange={setInOutText} options={inOutOptions} placeholder="IN / OUT" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{tFields("quantity")}</label>
              <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={!canSubmit || createPart.isPending}
            onClick={async () => {
              if (!selectedProduct || (resolvedInOut !== "IN" && resolvedInOut !== "OUT")) return
              await createPart.mutateAsync({
                repairPlanId,
                input: { productId: selectedProduct.id, inOut: resolvedInOut, quantity: Number(quantity) },
              })
              onOpenChange(false)
            }}
          >
            {createPart.isPending ? tCommon("saving") : tCommon("add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Repair Plan's related "Part No" line-items section (AppSheet parity) —
// rendered inside DetailPanel's `extra` slot, below the core field grid.
// Deliberately a small, purpose-built widget rather than the shared
// DashboardPlanPanel/DataTable combo used for larger related-record lists
// elsewhere (e.g. MemberOrderDetail's OrderRelatedSection): those bring a
// search box, status filter, and multi-select chrome that don't apply to a
// short (typically single-digit) parts list and would just add noise the
// AppSheet source view doesn't have either.
export function RepairPartsSection({ repairPlanId, canEdit }: { repairPlanId: string; canEdit: boolean }) {
  const { t } = useTranslation("repair")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { data: parts = [], isPending } = useRepairPlanParts(repairPlanId)
  const deletePart = useDeleteRepairPlanPart()
  const [addOpen, setAddOpen] = React.useState(false)
  // Bumped every time the Add dialog is opened, and passed to it as `key` —
  // forces a remount (fresh draft state) per add session instead of an
  // effect-based reset (see schedule-agenda.tsx's own MarkJobDoneDialog for
  // the same pattern).
  const [addKey, setAddKey] = React.useState(0)
  const [expanded, setExpanded] = React.useState(false)
  const [deleting, setDeleting] = React.useState<RepairPlanPart | undefined>(undefined)

  function openAdd() {
    setAddKey((k) => k + 1)
    setAddOpen(true)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {tFields("partNo")}
          <Badge variant="secondary">{parts.length}</Badge>
        </h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setExpanded(true)}>
            <Maximize2 className="h-3.5 w-3.5" /> {tCommon("expand")}
          </Button>
          {canEdit && (
            <Button size="sm" className="h-7 gap-1 px-2" onClick={openAdd}>
              <Plus className="h-3.5 w-3.5" /> {tCommon("add")}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-md border max-h-64 overflow-y-auto">
        {isPending ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{tCommon("loading")}</p>
        ) : (
          <PartsTable parts={parts} canEdit={canEdit} onDelete={setDeleting} />
        )}
      </div>

      {canEdit && <AddPartDialog key={addKey} open={addOpen} onOpenChange={setAddOpen} repairPlanId={repairPlanId} />}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {tFields("partNo")} <Badge variant="secondary">{parts.length}</Badge>
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <PartsTable parts={parts} canEdit={canEdit} onDelete={setDeleting} />
          </div>
          {canEdit && (
            <DialogFooter>
              <Button size="sm" className="gap-1.5" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" /> {t("addPart")}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deletePartTitle")}
        description={t("deletePartDescription")}
        loading={deletePart.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deletePart.mutateAsync({ id: deleting.id, repairPlanId })
          setDeleting(undefined)
        }}
      />
    </div>
  )
}
