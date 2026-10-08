// PostgREST (Supabase's REST layer) silently caps an un-ranged `select()`
// at its configured max-rows (1000 by default on this project) — a plain
// `.select("*")` on a table that grows past that limit doesn't error, it
// just quietly returns the first page ordered rows and drops the rest.
// Confirmed live: filter_change_plans (constantly growing — every day's
// recurring-schedule cron adds more future occurrences) already has 1,137
// rows against that 1,000-row cap, so a real ~137 rows were invisible to
// every part of the app that lists it, including Filter Change/Collection
// panels on the dashboard.
//
// Pages through with `.range()` until a page comes back short of a full
// page, so every caller gets the complete table regardless of how large it
// has grown, without needing to know or track that size itself.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

// Same result as fetchAllRows, but requests the pages CONCURRENTLY, a batch
// of `concurrency` at a time, instead of one round trip after another. For a
// table of a few thousand rows that's one batch: measured on /filter-change
// (3,241 rows, four 1,000-row pages at ~0.5s each) the sequential loop alone
// took ~1.9s before the table could render. A batch whose last page comes
// back short ends it; a fully empty extra page costs one cheap request.
//
// The caller's query MUST have a unique, deterministic order (e.g. a final
// `.order("id")` tiebreaker) — pages fetched independently of each other
// could otherwise overlap or skip rows that tie on the sort column.
export async function fetchAllRowsConcurrent<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  concurrency = 4
): Promise<T[]> {
  const rows: T[] = []
  for (let start = 0; ; start += concurrency * PAGE_SIZE) {
    const pages = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => buildQuery(start + i * PAGE_SIZE, start + (i + 1) * PAGE_SIZE - 1))
    )
    for (const { error } of pages) if (error) throw error
    for (const { data } of pages) {
      rows.push(...(data ?? []))
      if (!data || data.length < PAGE_SIZE) return rows
    }
  }
}
