"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
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
import { FormItem } from "@/components/ui/form"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Textarea } from "@/components/ui/textarea"
import { PRODUCT_CATEGORIES } from "@/lib/constants"
import { useCreateProduct, useUpdateProduct } from "@/lib/hooks/use-inventory"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { parseItemString } from "@/lib/utils"
import type { Product } from "@/lib/types"

const CATEGORY_OPTIONS: ComboboxOption[] = PRODUCT_CATEGORIES.map((c) => ({ value: c }))

function createSchema(
  t: (key: string, params?: Record<string, string>) => string,
  ti: (key: string) => string,
  tf: (key: string) => string
) {
  return z.object({
    name: z.string().min(2, t("requiredField", { field: ti("item") })),
    // Plain non-empty string, not z.enum(PRODUCT_CATEGORIES) — the category
    // column itself has never been a DB enum, and AppSheet's own category
    // values (e.g. "MW") aren't guaranteed to be one of this form's own
    // preset options. PRODUCT_CATEGORIES stays the Combobox's quick-pick
    // list, but any typed value is accepted (see the Combobox below).
    category: z.string().min(1, t("selectField", { field: tf("category") })),
    sku: z.string().min(2, t("requiredField", { field: tf("sku") })),
    description: z.string().optional(),
    // AppSheet's own static Stock Balances columns — see the Product type's
    // own comment on why these are separate from stock_quantity/
    // min_stock_level (real, trigger-maintained operational fields no
    // longer collected by this form) and from the /inventory list page's
    // own live-computed pBalance/inStockOnDate/outStockOnDate/balance.
    pBalance: z.number().int().min(0),
    inStock: z.number().int().min(0),
    outStock: z.number().int().min(0),
    balance: z.number().int().min(0),
    brandNew: z.number().int().min(0),
    secondHand: z.number().int().min(0),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(product?: Product): FormValues {
  return {
    name: product?.name ?? "",
    category: product?.category ?? PRODUCT_CATEGORIES[0],
    sku: product?.sku ?? "",
    description: product?.description ?? "",
    pBalance: product?.pBalance ?? 0,
    inStock: product?.inStock ?? 0,
    outStock: product?.outStock ?? 0,
    balance: product?.balance ?? 0,
    brandNew: product?.brandNew ?? 0,
    secondHand: product?.secondHand ?? 0,
  }
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
  liveStock,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product
  // The product's current stock as the Inventory table shows it: Brand New
  // from stock_quantity, the three buckets from the approved movement ledger.
  // When given (editing), Brand New / 2nd Hand / Balance are shown here as
  // read-only calculated values instead of the static numbers stored on the
  // record — those stopped feeding the table when stock_quantity became the
  // source of truth, so editing them silently did nothing. Stock changes now
  // go through an In/Out movement.
  liveStock?: { brandNew: number; secondHandReady: number; secondHandRepair: number; demo: number }
}) {
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const isEdit = !!product
  const { t } = useTranslation("inventory")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, t, tFields), [tCommon, t, tFields])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(product),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(product))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product])

  async function onSubmit(values: FormValues) {
    if (isEdit) {
      // With liveStock those three aren't editable here, so they're left out
      // of the write rather than re-saving whatever the form was seeded with
      // (for balance that is the table's as-of-date figure, not the stored one).
      const input = liveStock
        ? {
            name: values.name,
            category: values.category,
            sku: values.sku,
            description: values.description,
            pBalance: values.pBalance,
            inStock: values.inStock,
            outStock: values.outStock,
          }
        : values
      await updateProduct.mutateAsync({ id: product.id, input })
    } else {
      await createProduct.mutateAsync(values)
    }
    onOpenChange(false)
  }

  const pending = createProduct.isPending || updateProduct.isPending
  const errors = form.formState.errors

  // Plain uncontrolled inputs (register(), not a Controller value/onChange binding) —
  // this is the same fix used for the login page: some browser/extension setups fight
  // a *controlled* value, and it also means a "0" can be backspaced/replaced in one go
  // instead of requiring a double-click-to-select first.
  const numberField = (name: keyof FormValues, label: string) => (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step="1"
        aria-invalid={!!errors[name]}
        onFocus={(e) => e.target.select()}
        {...form.register(name, { valueAsNumber: true })}
      />
      {errors[name] && <p className="text-destructive text-sm">{errors[name]?.message as string}</p>}
    </div>
  )

  // A calculated value: shown like the inputs around it but not editable, with
  // the formula underneath so it's clear what feeds it.
  const readOnlyField = (label: string, value: number, formula?: string) => (
    <div className="grid content-start gap-2">
      <Label>{label}</Label>
      <Input type="number" value={value} readOnly disabled aria-label={label} />
      {formula && <p className="text-xs text-muted-foreground">{formula}</p>}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2 sm:col-span-2">
                <Label>{t("item")}</Label>
                <Input
                  placeholder="011 / MW) Pre-Sediment"
                  aria-invalid={!!errors.name}
                  {...form.register("name", {
                    // Auto-fills SKU/Description the moment a "[SKU] /
                    // [Description]" value is entered here — only when
                    // both are still blank, so this never clobbers
                    // something already typed in independently (e.g. an
                    // edit where SKU/Description were set separately from
                    // the Item name).
                    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
                      const parsed = parseItemString(e.target.value)
                      if (!parsed) return
                      if (!form.getValues("sku")) form.setValue("sku", parsed.sku, { shouldValidate: true })
                      if (!form.getValues("description")) form.setValue("description", parsed.description)
                    },
                  })}
                />
                <p className="text-xs text-muted-foreground">{t("itemAutoParseHint")}</p>
                {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
              </div>
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <Label>{tFields("category")}</Label>
                    {/* Free-text combobox, not a strict Select — AppSheet's own
                        category values (e.g. "MW") are typed, not chosen from a
                        fixed enum. PRODUCT_CATEGORIES is still offered as a
                        below-anchored quick-pick list, but any typed value is
                        accepted as-is. */}
                    <Combobox
                      value={field.value}
                      onChange={field.onChange}
                      options={CATEGORY_OPTIONS}
                      placeholder={tCommon("selectField", { field: tFields("category") })}
                    />
                    {errors.category && <p className="text-destructive text-sm">{errors.category.message}</p>}
                  </FormItem>
                )}
              />
              <div className="grid gap-2">
                <Label>{tFields("sku")}</Label>
                <Input placeholder="SK01" aria-invalid={!!errors.sku} {...form.register("sku")} />
                {errors.sku && <p className="text-destructive text-sm">{errors.sku.message}</p>}
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label>{t("descriptionOptional")}</Label>
                <Textarea rows={2} placeholder="MW) Pre-Sediment" {...form.register("description")} />
              </div>
              {numberField("pBalance", t("pBalance"))}
              {numberField("inStock", t("inStock"))}
              {numberField("outStock", t("outStock"))}
              {liveStock ? (
                <>
                  {readOnlyField(t("brandNew"), liveStock.brandNew)}
                  {readOnlyField(t("secondHandReady"), liveStock.secondHandReady)}
                  {readOnlyField(t("secondHandRepair"), liveStock.secondHandRepair)}
                  {readOnlyField(
                    t("secondHand"),
                    liveStock.secondHandReady + liveStock.secondHandRepair,
                    `${t("secondHandReady")} + ${t("secondHandRepair")}`
                  )}
                  {readOnlyField(t("demo"), liveStock.demo)}
                  {readOnlyField(
                    t("balance"),
                    liveStock.brandNew + liveStock.secondHandReady + liveStock.secondHandRepair + liveStock.demo,
                    `${t("brandNew")} + ${t("secondHand")} + ${t("demo")}`
                  )}
                </>
              ) : (
                <>
                  {numberField("balance", t("balance"))}
                  {numberField("brandNew", t("brandNew"))}
                  {numberField("secondHand", t("secondHand"))}
                </>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : t("addProduct")}
              </Button>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  )
}
