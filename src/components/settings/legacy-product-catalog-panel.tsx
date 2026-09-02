import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PRODUCT_CATALOG } from "@/lib/constants"

// Read-only reference for the legacy AppSheet product codes still offered as
// suggestions in the Sale List entry form's Product# field (see
// sale-list-form-dialog.tsx's LEGACY_PRODUCT_OPTIONS) — this panel exists
// purely so an admin can browse that list without opening the form. Grouped
// by brand prefix exactly the way the dropdown groups them.
//
// Deliberately frozen, not addable: a UI to add new entries here would just
// be a thinner duplicate of the Inventory products table (code+name+group vs.
// SKU+name+category+supplier+stock+pricing), which already has its own "Add
// Product" UI and already appears in the same Sale List dropdown alongside
// this list (see PRODUCT_OPTIONS in sale-list-form-dialog.tsx). New products
// belong there, not here — this list stays a true historical snapshot of the
// old system's codes.
export function LegacyProductCatalogPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Legacy Product Catalog</CardTitle>
        <CardDescription>
          Reference codes carried over from the old system — still offered as suggestions in the Sale List entry
          form&apos;s Product# field, grouped the same way here. This list is historical and no longer added to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/50 p-3">
          <p className="text-sm text-muted-foreground">
            To add a new product — it&apos;ll show up in the Sale List&apos;s Product# suggestions too — use Inventory
            instead.
          </p>
          <Link href="/inventory" className="shrink-0">
            <Button size="sm" variant="outline" className="gap-1.5">
              Inventory <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
        {PRODUCT_CATALOG.map((group) => (
          <div key={group.group} className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{group.group}</p>
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
      </CardContent>
    </Card>
  )
}
