"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Combobox } from "@/components/ui/combobox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AUTOMATED_STOCK_MOVEMENT_REASONS, STOCK_MOVEMENT_REASONS } from "@/lib/constants"
import { dateFieldSchema } from "@/lib/form-schemas"
import { useAuth } from "@/lib/auth/auth-context"
import {
  useAddStockMovement,
  useProducts,
  useStockMovementRows,
  useUpdateStockMovement,
  useUpdateStockMovements,
  type StockMovementRow,
} from "@/lib/hooks/use-inventory"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { generateId, todayIso } from "@/lib/utils"
import type { StockMovement } from "@/lib/types"

function createAddSchema(
  t: (key: string, params?: Record<string, string>) => string,
  ti: (key: string) => string
) {
  return z
    .object({
      productId: z.string().min(1, t("selectField", { field: ti("product") })),
      date: dateFieldSchema(t, ti("date")),
      direction: z.enum(["in", "out"]),
      reason: z.enum(STOCK_MOVEMENT_REASONS),
      quantity: z.number().int().min(0),
      secondHandReadyQuantity: z.number().int().min(0),
      secondHandRepairQuantity: z.number().int().min(0),
      demoQuantity: z.number().int().min(0),
    })
    .refine(
      (data) =>
        data.quantity > 0 || data.secondHandReadyQuantity > 0 || data.secondHandRepairQuantity > 0 || data.demoQuantity > 0,
      {
        message: ti("quantityAtLeastOneField"),
        path: ["quantity"],
      }
    )
}

type AddFormValues = z.infer<ReturnType<typeof createAddSchema>>

// Edit mode exposes Qty Added / Qty Removed / condition buckets directly (rather
// than the Add flow's single Quantity + Direction) so a wrong entry — e.g. an
// accidental Qty Removed — can just be corrected or cleared to 0 in place.
const editSchema = z.object({
  reason: z.enum(STOCK_MOVEMENT_REASONS),
  quantityAdded: z.number().int().min(0),
  quantityRemoved: z.number().int().min(0),
  secondHandReadyQuantity: z.number().int(),
  secondHandRepairQuantity: z.number().int(),
  demoQuantity: z.number().int(),
})

type EditFormValues = z.infer<typeof editSchema>

function editDefaultValues(m: StockMovement): EditFormValues {
  return {
    // The reason field only accepts the manually-selectable reasons
    // (STOCK_MOVEMENT_REASONS) — an automated-only reason (Sale, Filter
    // Change, Repair) can still land here now that the Daily Report
    // Inventory List's own Edit button opens this same dialog with no
    // reason-based filtering, so this falls back to "Adjustment" rather
    // than handing the <Select> a value it has no matching option for.
    reason: (AUTOMATED_STOCK_MOVEMENT_REASONS as readonly string[]).includes(m.reason) ? "Adjustment" : (m.reason as EditFormValues["reason"]),
    quantityAdded: m.quantityAdded,
    quantityRemoved: m.quantityRemoved,
    secondHandReadyQuantity: m.secondHandReadyQuantity,
    secondHandRepairQuantity: m.secondHandRepairQuantity,
    demoQuantity: m.demoQuantity,
  }
}

export function StockMovementFormDialog({
  open,
  onOpenChange,
  movement,
  defaultDirection = "in",
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // An Inventory List row combining several movements (mergedIds) opens the
  // grouped edit form instead, which edits each combined entry.
  movement?: StockMovement & { mergedIds?: string[] }
  // Which direction the Add form should default to (e.g. opening it from the
  // In & Out Summary's "Out Stock" panel should default to Stock Out). Ignored
  // in edit mode.
  defaultDirection?: "in" | "out"
  // Pre-fills the Add form's editable Date — the date the page it was opened
  // from is currently showing (Inventory's Date, the Daily Report's date), so
  // an entry made while viewing a past day files under that day. Falls back to
  // today. Ignored in edit mode, which has no Date field.
  defaultDate?: string
}) {
  const isEdit = !!movement
  const isGrouped = (movement?.mergedIds?.length ?? 1) > 1
  const { t } = useTranslation("inventory")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isGrouped ? t("editGroupedTitle") : isEdit ? t("editStockMovementTitle") : t("addStockMovementTitle")}</DialogTitle>
          <DialogDescription>
            {isGrouped
              ? t("editGroupedDescription", { count: String(movement?.mergedIds?.length ?? 0) })
              : isEdit
                ? t("editStockMovementDescription")
                : t("addStockMovementDescription")}
          </DialogDescription>
        </DialogHeader>
        {isGrouped && movement?.mergedIds ? (
          <GroupedEditForm key={movement.mergedIds.join(",")} mergedIds={movement.mergedIds} onOpenChange={onOpenChange} />
        ) : isEdit ? (
          <EditMovementForm movement={movement} open={open} onOpenChange={onOpenChange} />
        ) : (
          <AddMovementForm
            open={open}
            onOpenChange={onOpenChange}
            defaultDirection={defaultDirection}
            defaultDate={defaultDate}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddMovementForm({
  open,
  onOpenChange,
  defaultDirection,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultDirection: "in" | "out"
  defaultDate?: string
}) {
  const { user } = useAuth()
  const { data: products = [] } = useProducts()
  const addMovement = useAddStockMovement()
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const addSchema = React.useMemo(() => createAddSchema(tCommon, t), [tCommon, t])

  const defaultsFor = (direction: "in" | "out"): AddFormValues => ({
    productId: "",
    date: defaultDate || todayIso(),
    direction,
    reason: direction === "in" ? "Restock" : "Adjustment",
    quantity: 1,
    secondHandReadyQuantity: 0,
    secondHandRepairQuantity: 0,
    demoQuantity: 0,
  })

  const form = useForm<AddFormValues>({
    resolver: zodResolver(addSchema),
    defaultValues: defaultsFor(defaultDirection),
  })

  // The Product field is typable: the text typed or picked, and the product
  // it names exactly (any letter case) — only that sets productId.
  const [productText, setProductText] = React.useState("")
  const productOptions = React.useMemo(() => products.map((p) => ({ value: p.name })), [products])
  const changeProductText = (text: string) => {
    setProductText(text)
    const match = products.find((p) => p.name.trim().toLowerCase() === text.trim().toLowerCase())
    form.setValue("productId", match?.id ?? "", { shouldValidate: form.formState.isSubmitted })
  }

  React.useEffect(() => {
    if (open) {
      form.reset(defaultsFor(defaultDirection))
      setProductText("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDirection, defaultDate])

  async function onSubmit(values: AddFormValues) {
    const quantityAdded = values.direction === "in" ? values.quantity : 0
    const quantityRemoved = values.direction === "out" ? values.quantity : 0
    // Direction applies to the condition buckets too — Stock Out subtracts from
    // their running totals instead of always adding to them.
    const sign = values.direction === "out" ? -1 : 1

    await addMovement.mutateAsync({
      date: values.date,
      productId: values.productId,
      quantityAdded,
      quantityRemoved,
      secondHandReadyQuantity: sign * values.secondHandReadyQuantity,
      secondHandRepairQuantity: sign * values.secondHandRepairQuantity,
      demoQuantity: sign * values.demoQuantity,
      reason: values.reason,
      userId: user?.id ?? "",
      referenceNumber: generateId("ADJ").toUpperCase(),
    })
    onOpenChange(false)
  }

  const selectedProductId = form.watch("productId")
  const selectedProduct = products.find((p) => p.id === selectedProductId)

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="productId"
          render={() => (
            <FormItem>
              <FormLabel>{t("product")}</FormLabel>
              <FormControl>
                <Combobox
                  value={productText}
                  onChange={changeProductText}
                  options={productOptions}
                  placeholder={t("productTypeToSearch")}
                  maxResults={20}
                  emptyMessage={t("noMatchingProduct")}
                  openOnFocus={false}
                  data-testid="movement-product"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {selectedProduct && (
          <p className="text-sm text-muted-foreground">{t("currentStockUnits", { stock: String(selectedProduct.stockQuantity) })}</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="direction"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("direction")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="in">{t("stockIn")}</SelectItem>
                    <SelectItem value="out">{t("stockOut")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("reason")}</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {STOCK_MOVEMENT_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="quantity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tFields("quantity")}</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    value={field.value}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("date")}</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {(
            [
              ["secondHandReadyQuantity", t("secondHandReady")],
              ["secondHandRepairQuantity", t("secondHandRepair")],
              ["demoQuantity", t("demo")],
            ] as const
          ).map(([name, label]) => (
            <FormField
              key={name}
              control={form.control}
              name={name}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{label}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={field.value}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber || 0
                        field.onChange(value)
                        // A movement is either regular stock or one of the condition
                        // buckets, not both — entering a bucket quantity clears Quantity.
                        if (value > 0) form.setValue("quantity", 0)
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={addMovement.isPending}>
            {addMovement.isPending ? tCommon("saving") : t("addMovement")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

function EditMovementForm({
  movement,
  open,
  onOpenChange,
}: {
  movement: StockMovement
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data: products = [] } = useProducts()
  const updateMovement = useUpdateStockMovement()
  const selectedProduct = products.find((p) => p.id === movement.productId)
  const isSaleOrigin = movement.reason === "Sale"
  const isFilterChangeOrigin = movement.reason === "Filter Change"
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: editDefaultValues(movement),
  })

  React.useEffect(() => {
    if (open) form.reset(editDefaultValues(movement))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, movement])

  async function onSubmit(values: EditFormValues) {
    await updateMovement.mutateAsync({
      id: movement.id,
      input: {
        quantityAdded: values.quantityAdded,
        quantityRemoved: values.quantityRemoved,
        secondHandReadyQuantity: values.secondHandReadyQuantity,
        secondHandRepairQuantity: values.secondHandRepairQuantity,
        demoQuantity: values.demoQuantity,
        reason: values.reason,
      },
    })
    onOpenChange(false)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid gap-2">
          <Label>{t("product")}</Label>
          <Input value={selectedProduct?.name ?? t("unknownProduct")} disabled />
          <p className="text-xs text-muted-foreground">{t("productCannotBeChanged")}</p>
        </div>
        {selectedProduct && (
          <p className="text-sm text-muted-foreground">{t("currentStockUnits", { stock: String(selectedProduct.stockQuantity) })}</p>
        )}
        {isSaleOrigin && (
          <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-3 py-2">
            {t("saleOriginWarning")}
          </p>
        )}
        {isFilterChangeOrigin && (
          <p className="text-xs text-warning bg-warning/10 border border-warning/20 rounded-md px-3 py-2">
            {t("filterChangeOriginWarning")}
          </p>
        )}
        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("reason")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {STOCK_MOVEMENT_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>{t("qtyAdded")}</Label>
            <Input
              type="number"
              min={0}
              aria-invalid={!!form.formState.errors.quantityAdded}
              onFocus={(e) => e.target.select()}
              {...form.register("quantityAdded", { valueAsNumber: true })}
            />
            {form.formState.errors.quantityAdded && (
              <p className="text-destructive text-sm">{form.formState.errors.quantityAdded.message}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>{t("qtyRemoved")}</Label>
            <Input
              type="number"
              min={0}
              aria-invalid={!!form.formState.errors.quantityRemoved}
              onFocus={(e) => e.target.select()}
              {...form.register("quantityRemoved", { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">{t("clearIncorrectRemoval")}</p>
            {form.formState.errors.quantityRemoved && (
              <p className="text-destructive text-sm">{form.formState.errors.quantityRemoved.message}</p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="grid gap-2">
            <Label>{t("secondHandReady")}</Label>
            <Input
              type="number"
              aria-invalid={!!form.formState.errors.secondHandReadyQuantity}
              onFocus={(e) => e.target.select()}
              {...form.register("secondHandReadyQuantity", { valueAsNumber: true })}
            />
            {form.formState.errors.secondHandReadyQuantity && (
              <p className="text-destructive text-sm">{form.formState.errors.secondHandReadyQuantity.message}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>{t("secondHandRepair")}</Label>
            <Input
              type="number"
              aria-invalid={!!form.formState.errors.secondHandRepairQuantity}
              onFocus={(e) => e.target.select()}
              {...form.register("secondHandRepairQuantity", { valueAsNumber: true })}
            />
            {form.formState.errors.secondHandRepairQuantity && (
              <p className="text-destructive text-sm">{form.formState.errors.secondHandRepairQuantity.message}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label>{t("demo")}</Label>
            <Input
              type="number"
              aria-invalid={!!form.formState.errors.demoQuantity}
              onFocus={(e) => e.target.select()}
              {...form.register("demoQuantity", { valueAsNumber: true })}
            />
            {form.formState.errors.demoQuantity && (
              <p className="text-destructive text-sm">{form.formState.errors.demoQuantity.message}</p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("positiveAddsNegativeSubtracts")}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={updateMovement.isPending}>
            {updateMovement.isPending ? tCommon("saving") : tCommon("saveChanges")}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

const KEEP_REASON = "__keep"

// Edits every movement an Inventory List row combines (several of one item on
// a job, or the modal's cross-job totals): one quantity per entry, labelled
// with its job, and optionally one reason for all. Only entries that actually
// change are saved, each on its own, so every one keeps its own job link and
// its own stock effect (an approved entry adjusts stock the same way the
// single edit does).
function GroupedEditForm({
  mergedIds,
  onOpenChange,
}: {
  mergedIds: string[]
  onOpenChange: (open: boolean) => void
}) {
  const { data: rows = [] } = useStockMovementRows()
  const updateMany = useUpdateStockMovements()
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const { t: tStatus } = useTranslation("status")

  const members = React.useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r]))
    return mergedIds.map((id) => byId.get(id)).filter((r): r is StockMovementRow => !!r)
  }, [rows, mergedIds])
  // A grouped row always shares one direction (see the grouping functions).
  const isIn = members.length > 0 && members.every((m) => m.quantityAdded > 0 && m.quantityRemoved === 0)
  const qtyOf = (m: StockMovementRow) => (isIn ? m.quantityAdded : m.quantityRemoved)

  // Fresh for each opening: the dialog unmounts its content when closed, and
  // the form is keyed by the row it edits.
  const [quantities, setQuantities] = React.useState<Record<string, number>>({})
  const [reason, setReason] = React.useState<string>(KEEP_REASON)

  const valueOf = (m: StockMovementRow) => quantities[m.id] ?? qtyOf(m)
  const total = members.reduce((sum, m) => sum + valueOf(m), 0)
  const invalid = members.some((m) => !Number.isInteger(valueOf(m)) || valueOf(m) < 0)
  const jobOf = (m: StockMovementRow) => m.relatedJobOrderNo || m.referenceNumber || "—"

  async function onSave() {
    const updates = members.flatMap((m) => {
      const qty = valueOf(m)
      const qtyChanged = qty !== qtyOf(m)
      const reasonChanged = reason !== KEEP_REASON && reason !== m.reason
      if (!qtyChanged && !reasonChanged) return []
      return [
        {
          id: m.id,
          input: {
            quantityAdded: isIn ? qty : m.quantityAdded,
            quantityRemoved: isIn ? m.quantityRemoved : qty,
            secondHandReadyQuantity: m.secondHandReadyQuantity,
            secondHandRepairQuantity: m.secondHandRepairQuantity,
            demoQuantity: m.demoQuantity,
            reason: (reasonChanged ? reason : m.reason) as StockMovement["reason"],
          },
        },
      ]
    })
    if (updates.length > 0) await updateMany.mutateAsync(updates)
    onOpenChange(false)
  }

  const qtyLabel = isIn ? t("qtyAdded") : t("qtyRemoved")
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label>{t("product")}</Label>
        <Input value={members[0]?.productName ?? t("unknownProduct")} disabled />
      </div>
      <div className="grid gap-2">
        <Label>{t("reason")}</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={KEEP_REASON}>{t("keepEachReason")}</SelectItem>
            {STOCK_MOVEMENT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("relatedJob")}</th>
              <th className="px-3 py-2 font-medium">{tFields("status")}</th>
              <th className="w-28 px-3 py-2 font-medium">{qtyLabel}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-3 py-1.5">
                  <div className="font-medium">{jobOf(m)}</div>
                  <div className="text-xs text-muted-foreground">{m.reason}</div>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{tStatus(m.status ?? "approved")}</td>
                <td className="px-3 py-1.5">
                  <Input
                    type="number"
                    min={0}
                    aria-label={`${qtyLabel} ${jobOf(m)}`}
                    className="h-8"
                    value={Number.isNaN(valueOf(m)) ? "" : valueOf(m)}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setQuantities((q) => ({ ...q, [m.id]: e.target.valueAsNumber }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-medium">
              <td className="px-3 py-2" colSpan={2}>
                {t("groupedTotal")}
              </td>
              <td className="px-3 py-2">{Number.isNaN(total) ? "—" : total}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {tCommon("cancel")}
        </Button>
        <Button type="button" onClick={onSave} disabled={invalid || members.length === 0 || updateMany.isPending}>
          {updateMany.isPending ? tCommon("saving") : tCommon("saveChanges")}
        </Button>
      </DialogFooter>
    </div>
  )
}
