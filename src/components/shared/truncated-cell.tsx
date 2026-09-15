import * as React from "react"
import { cn } from "@/lib/utils"

// A plain string value, capped at a fixed width with an ellipsis, and the
// full text restored as a native hover tooltip via `title` — for any table
// column holding free text or a concatenated value with no natural length
// limit (a name, an address, a code, a unit/model name). Without a bound,
// one long outlier anywhere in a (possibly unpaginated, "Rows per page:
// All") dataset would otherwise stretch that column — and the whole
// table's rendered width — since the base <TableCell> is whitespace-nowrap
// with no max-width of its own.
export function TruncatedCell({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("block max-w-37.5 truncate", className)} title={value}>
      {value}
    </span>
  )
}

// Same width cap and hover-tooltip idea as TruncatedCell, but for a cell
// whose content isn't a plain string — e.g. a TranslatableText-wrapped
// note/problem field, which needs its own `truncate` class applied to the
// element it actually renders rather than to this wrapper. `text` is the
// raw value for the tooltip; `children` is the already-built cell content.
export function TruncatedContainer({
  text,
  children,
  className,
}: {
  text: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("max-w-37.5", className)} title={text}>
      {children}
    </div>
  )
}
