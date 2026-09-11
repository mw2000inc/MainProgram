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
