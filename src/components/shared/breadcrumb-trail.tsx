"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

// AppSheet-style breadcrumb: each earlier segment is a link back up to that
// level (used for the Member section's drill-down, where the level "minimizes"
// into this crumb instead of staying visible); the last segment is the
// current, non-interactive page. Segments with no onClick (e.g. a static
// "MW CP" root label) render as plain text throughout.
export function BreadcrumbTrail({
  items,
}: {
  items: { label: string; onClick?: () => void }[]
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
            {item.onClick && !isLast ? (
              <button type="button" onClick={item.onClick} className="hover:text-foreground hover:underline">
                {item.label}
              </button>
            ) : (
              <span className={cn(isLast && "font-medium text-foreground")}>{item.label}</span>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}
