"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Combobox } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { filterCodeOf } from "@/lib/filter-codes"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { Product } from "@/lib/types"

export type FilterRow = { key: number; value: string; quantity: string }

let rowKey = 0
export const newFilterRow = (value = "", quantity = "1"): FilterRow => ({ key: rowKey++, value, quantity })

// The Schedule Job form's "Filters to Deduct": one row per filter — a
// typeable, searchable pick from inventory (code or name: "013", "UF",
// "Sediment") or any code typed by hand — with its own quantity, and
// "+ Add Filter" for as many as the job needs. Saved as the job's filter
// codes (see filter-codes.ts); a code that isn't in inventory is kept on the
// job but not deducted.
export function FilterDeductRows({
  rows,
  onChange,
  products,
}: {
  rows: FilterRow[]
  onChange: (rows: FilterRow[]) => void
  products: Product[]
}) {
  const { t } = useTranslation("schedule")
  const options = React.useMemo(
    () => products.map((p) => ({ value: p.name?.includes(" / ") ? p.name : `${p.sku} / ${p.name}`, group: p.category || undefined })),
    [products]
  )
  const skus = React.useMemo(() => new Set(products.map((p) => p.sku.trim())), [products])
  const update = (key: number, patch: Partial<FilterRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-2" data-testid="filter-deduct-rows">
      {rows.map((row) => {
        const code = filterCodeOf(row.value)
        return (
          <div key={row.key} className="space-y-0.5" data-testid="filter-deduct-row">
            <div className="flex items-center gap-2">
              <Combobox
                value={row.value}
                onChange={(value) => update(row.key, { value })}
                options={options}
                placeholder={t("filterSearchPlaceholder")}
                maxResults={30}
                className="min-w-0 flex-1"
                aria-label={t("filtersToDeductOptional")}
                data-testid="filter-deduct-code"
              />
              <Input
                type="number"
                min={1}
                max={99}
                step={1}
                value={row.quantity}
                onChange={(e) => update(row.key, { quantity: e.target.value })}
                className="w-16 shrink-0"
                aria-label={t("quantityToDeduct")}
                data-testid="filter-deduct-qty"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-danger hover:text-danger"
                aria-label={t("removeFilter")}
                onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {code && !skus.has(code) && <p className="text-xs text-warning">{t("filterNotInInventory")}</p>}
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => onChange([...rows, newFilterRow()])} data-testid="filter-deduct-add">
        <Plus className="h-3.5 w-3.5" /> {t("addFilter")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("filtersDeductNote")}</p>
    </div>
  )
}
