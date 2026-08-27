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
import { PRODUCT_CATEGORIES } from "@/lib/constants"
import { useCreateProduct, useUpdateProduct, useSuppliers, suppliersKey } from "@/lib/hooks/use-inventory"
import { SupplierFormDialog } from "@/components/inventory/supplier-form-dialog"
import type { Product } from "@/lib/types"

const ADD_NEW_SUPPLIER = "__add_new_supplier__"

const schema = z.object({
  name: z.string().min(2, "Product name is required"),
  category: z.enum(PRODUCT_CATEGORIES),
  supplierId: z.string().min(1, "Select a supplier"),
  sku: z.string().min(2, "SKU is required"),
  barcode: z.string().optional(),
  stockQuantity: z.number().int().min(0),
  minStockLevel: z.number().int().min(0),
  purchasePrice: z.number().min(0),
  sellingPrice: z.number().min(0),
})

type FormValues = z.infer<typeof schema>

function defaultValues(product?: Product): FormValues {
  return {
    name: product?.name ?? "",
    category: (product?.category as FormValues["category"]) ?? PRODUCT_CATEGORIES[0],
    supplierId: product?.supplierId ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    stockQuantity: product?.stockQuantity ?? 0,
    minStockLevel: product?.minStockLevel ?? 10,
    purchasePrice: product?.purchasePrice ?? 0,
    sellingPrice: product?.sellingPrice ?? 0,
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
  const numberField = (name: keyof FormValues, label: string, step = "1") => (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step={step}
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
          <DialogTitle>{isEdit ? "Edit Product" : "Add Product"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this inventory item." : "Register a new inventory item."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2 sm:col-span-2">
                <Label>Product Name</Label>
                <Input placeholder="5-Stage RO Filter System" aria-invalid={!!errors.name} {...form.register("name")} />
                {errors.name && <p className="text-destructive text-sm">{errors.name.message}</p>}
              </div>
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <Label>Category</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
              <Controller
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem>
                    <Label>Supplier</Label>
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
                        <SelectValue placeholder="Select supplier">
                          {suppliers.find((s) => s.id === field.value)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ADD_NEW_SUPPLIER} className="text-primary font-medium">
                          <Truck className="h-4 w-4" /> Add New Supplier
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
                <Label>SKU</Label>
                <Input placeholder="SK01" aria-invalid={!!errors.sku} {...form.register("sku")} />
                {errors.sku && <p className="text-destructive text-sm">{errors.sku.message}</p>}
              </div>
              <div className="grid gap-2">
                <Label>Barcode (Optional)</Label>
                <Input placeholder="4801234567893" {...form.register("barcode")} />
              </div>
              {numberField("stockQuantity", "Stock Quantity")}
              {numberField("minStockLevel", "Minimum Stock Level")}
              {numberField("purchasePrice", "Purchase Price", "0.01")}
              {numberField("sellingPrice", "Selling Price", "0.01")}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Add Product"}
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
