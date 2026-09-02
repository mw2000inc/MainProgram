"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ProductFormDialog } from "@/components/inventory/product-form-dialog"
import { useProducts } from "@/lib/hooks/use-inventory"
import { PRODUCT_CATALOG } from "@/lib/constants"
import type { Product } from "@/lib/types"

// Groups live products by category (Purifiers/Filters/Accessories) the same
// way the legacy list below groups by brand prefix, for a visually
// consistent read here.
function groupByCategory(products: Product[]): { group: string; items: Product[] }[] {
  const map = new Map<string, Product[]>()
  for (const p of products) {
    if (!map.has(p.category)) map.set(p.category, [])
    map.get(p.category)!.push(p)
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }))
}

// Two sources feed the Sale List entry form's Product# suggestions (see
// PRODUCT_OPTIONS in sale-list-form-dialog.tsx): real Inventory products
// (live, addable right here — reuses the exact same ProductFormDialog/
// useCreateProduct the Inventory page itself uses, so a product added here
// saves to the same real table and shows up in both places immediately) and
// the legacy AppSheet catalog (frozen, historical, intentionally not
// addable — see that section's own comment below for why).
export function ProductCatalogPanel() {
  const { data: products = [], isPending } = useProducts()
  const [addOpen, setAddOpen] = React.useState(false)
  const productGroups = React.useMemo(() => groupByCategory(products), [products])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Product Catalog</CardTitle>
        <CardDescription>
          Everything offered as a suggestion in the Sale List entry form&apos;s Product# field — real Inventory
          products below, plus a frozen legacy reference further down.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inventory Products</p>
            <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Product
            </Button>
          </div>
          {isPending && (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}
          {!isPending && products.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
              No products in Inventory yet — click Add Product to create one.
            </p>
          )}
          {!isPending && productGroups.length > 0 && (
            <div className="space-y-4">
              {productGroups.map((group) => (
                <div key={group.group} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{group.group}</p>
                  <div className="divide-y rounded-md border">
                    {group.items.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="font-mono text-muted-foreground shrink-0">{item.sku}</span>
                        <span className="truncate">{item.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Deliberately frozen, not addable: a UI to add new entries here
            would just be a thinner duplicate of Inventory Products above
            (code+name+group vs. SKU+name+category+supplier+stock+pricing).
            New products belong in Inventory — this list stays a true
            historical snapshot of the old system's codes. */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Legacy Catalog (historical, no longer added to)
          </p>
          <div className="space-y-4">
            {PRODUCT_CATALOG.map((group) => (
              <div key={group.group} className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{group.group}</p>
                <div className="divide-y rounded-md border">
                  {group.items.map((item) => (
                    <div key={item.code} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="font-mono text-muted-foreground shrink-0">{item.code}</span>
                      <span className="truncate">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>

      <ProductFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </Card>
  )
}
