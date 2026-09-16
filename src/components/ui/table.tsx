"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  // Purely structural now — see the comment below for why this div no
  // longer does any scrolling of its own. A caller can still add a
  // non-overflow class here (a border, padding, etc.) if it ever needs to.
  containerClassName?: string
}) {
  return (
    // Empirically confirmed (via a real headless-browser scroll test, not
    // just reasoning about the spec) that this div CANNOT independently
    // handle horizontal overflow while leaving vertical overflow to an
    // ancestor: per the CSS Overflow spec, once either overflow-x or
    // overflow-y computes to anything but `visible`, the OTHER axis is
    // *unconditionally* forced to `auto` too — there is no way to declare
    // overflow-x: auto and have overflow-y genuinely stay `visible`, even
    // by setting it explicitly (a previous fix here tried exactly that,
    // assuming the coupling only applied to an axis left at its unset
    // default — it doesn't; the browser's actual computed style confirmed
    // overflow-y as auto regardless). That silently made this div its own
    // vertical scroll container too, and since it sits directly between
    // <thead> and DataTable's real, height-bounded scroll wrapper,
    // position: sticky bound to THIS div's own content-sized (never
    // actually scrolling) box instead of that outer one — which is why the
    // sticky header detached and scrolled away instead of pinning, even
    // after DataTable's own wrapper was correctly height-bounded.
    //
    // The real fix: this div does no scrolling of its own at all (plain
    // `relative`, both axes left at their default `visible`). Horizontal
    // overflow simply bubbles up to DataTable's own outer wrapper, which
    // already handles both overflow-x and overflow-y together (both
    // non-visible, so the coupling rule is a no-op there) — one real
    // scroll container for the whole table instead of two competing ones.
    <div data-slot="table-container" className={cn("relative w-full", containerClassName)}>
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

// Sticky by default — every table's header row stays pinned to the top of
// its nearest scrolling ancestor (Table's own containerClassName, or
// DataTable's scroll wrapper when going through that) as the body scrolls
// past it. z-30 keeps it above row content (and above anything else at a
// lower z-index that might otherwise sit on top of it, e.g. an
// inline-editable cell's own focus ring, or the app topbar at z-30 in
// layout.tsx should a table ever render close enough to it to matter);
// bg-card (also set on TableHead below) keeps scrolled-under rows from
// showing through the header, and shadow-sm gives the pinned row a subtle
// edge so it doesn't look like it's floating flush against the content
// sliding underneath it. A caller that genuinely needs a non-sticky header
// can still override via className (e.g. "static") since this merges
// through cn() like any other class here.
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("sticky top-0 z-30 bg-card shadow-sm [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground bg-card [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
