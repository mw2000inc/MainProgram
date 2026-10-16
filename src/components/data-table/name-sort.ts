import type { Row } from "@tanstack/react-table"

// A–Z / Z–A for a name column (Account Name, Contact Person, Member…): case
// and stray spaces ignored (" BRIAN EDGER" sorts with the B's), numbers in a
// name in natural order, and blank names always last whichever way it's
// sorted. Spread into the column next to its accessorKey — the key stays, so
// the column's id, search and Daily Report visible-fields setting don't
// change:
//   { accessorKey: "accountName", ...nameSort<CollectionPlan>((r) => r.accountName), … }
export function nameSort<T>(get: (row: T) => string | null | undefined) {
  return {
    accessorFn: (row: T) => get(row)?.trim() || undefined,
    sortUndefined: "last" as const,
    sortingFn: (a: Row<T>, b: Row<T>, id: string) =>
      String(a.getValue(id)).localeCompare(String(b.getValue(id)), undefined, { sensitivity: "base", numeric: true }),
  }
}
