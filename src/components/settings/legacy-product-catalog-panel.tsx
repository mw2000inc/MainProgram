import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PRODUCT_CATALOG } from "@/lib/constants"

// Read-only reference for the legacy AppSheet product codes still offered as
// suggestions in the Sale List entry form's Product# field (see
// sale-list-form-dialog.tsx's LEGACY_PRODUCT_OPTIONS) — this panel exists
// purely so an admin can browse that list without opening the form. Grouped
// by brand prefix exactly the way the dropdown groups them.
export function LegacyProductCatalogPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Legacy Product Catalog</CardTitle>
        <CardDescription>
          Reference codes carried over from the old system — still offered as suggestions in the Sale List entry
          form&apos;s Product# field, grouped the same way here. Real Inventory products also appear in that field
          automatically; see the Inventory page for those.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
