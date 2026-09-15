"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, Controller } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import { Truck } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Combobox, type ComboboxOption } from "@/components/ui/combobox"
import { Textarea } from "@/components/ui/textarea"
import { PRODUCT_CATEGORIES } from "@/lib/constants"
import { useCreateProduct, useUpdateProduct, useSuppliers, suppliersKey } from "@/lib/hooks/use-inventory"
import { SupplierFormDialog } from "@/components/inventory/supplier-form-dialog"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Product } from "@/lib/types"

const ADD_NEW_SUPPLIER = "__add_new_supplier__"

const CATEGORY_OPTIONS: ComboboxOption[] = PRODUCT_CATEGORIES.map((c) => ({ value: c }))

// AppSheet's own Item column is often (not always) a combined
// "[SKU] / [Description]" string — e.g. "011 / MW) Pre-Sediment" splits
// into SKU "011" and Description "MW) Pre-Sediment". Splits on the FIRST
// slash only (non-greedy first group), tolerant of the space padding
// either side of it actually being optional. Returns null for a plain
// name with no "/" at all — most existing/new items aren't required to
// follow this convention, so callers only auto-fill when this actually
// matches rather than forcing every Item value through it.
function parseItemString(item: string): { sku: string; description: string } | null {
  const match = item.match(/^(.+?)\s*\/\s*(.+)$/)
  if (!match) return null
  return { sku: match[1].trim(), description: match[2].trim() }
}

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
    supplierId: z.string().min(1, t("selectField", { field: tf("supplier") })),
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
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(product?: Product): FormValues {
  return {
    name: product?.name ?? "",
    category: product?.category ?? PRODUCT_CATEGORIES[0],
    supplierId: product?.supplierId ?? "",
    sku: product?.sku ?? "",
    description: product?.description ?? "",
    pBalance: product?.pBalance ?? 0,
    inStock: product?.inStock ?? 0,
    outStock: product?.outStock ?? 0,
    balance: product?.balance ?? 0,
    brandNew: product?.brandNew ?? 0,
  }
}

export function ProductFormDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product?: Product
}) {
  const queryClient = useQueryClient()
  const { data: suppliers = [] } = useSuppliers()
  const createProduct = useCreateProduct()
  const updateProduct = useUpdateProduct()
  const isEdit = !!product
  const [newSupplierOpen, setNewSupplierOpen] = React.useState(false)
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
      await updateProduct.mutateAsync({ id: product.id, input: values })
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

  return (
    <>
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
              <Controller
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <Label>{tFields("supplier")}</Label>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        if (v === ADD_NEW_SUPPLIER) {
                          setNewSupplierOpen(true)
                          return
                        }
                        field.onChange(v)
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={tCommon("selectField", { field: tFields("supplier") })}>
                          {suppliers.find((s) => s.id === field.value)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ADD_NEW_SUPPLIER} className="text-primary font-medium">
                          <Truck className="h-4 w-4" /> {t("addNewSupplier")}
                        </SelectItem>
                        <SelectSeparator />
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errors.supplierId && <p className="text-destructive text-sm">{errors.supplierId.message}</p>}
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
              {numberField("balance", t("balance"))}
              {numberField("brandNew", t("brandNew"))}
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
    <SupplierFormDialog
      open={newSupplierOpen}
      onOpenChange={setNewSupplierOpen}
      onCreated={(supplier) => {
        // Same deferred-setValue trick as the Sale form's inline "Add New Customer":
        // Radix's hidden native <select> needs its new <option> committed to the DOM
        // before the controlled value can point at it.
        queryClient.setQueryData(suppliersKey, (old: typeof suppliers = []) => [supplier, ...old])
        setTimeout(() => {
          form.setValue("supplierId", supplier.id, { shouldValidate: true })
        }, 0)
      }}
    />
    </>
  )
}
