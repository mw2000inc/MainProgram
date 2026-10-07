// Populates / updates the products table from scripts/data/inventory-catalog.json.
//
//   Dry run (default — reads only, writes nothing to Supabase):
//     npx tsx scripts/populate-inventory.ts
//   Apply (backs up every product first, then writes):
//     npx tsx scripts/populate-inventory.ts --apply
//
// Idempotent: products are matched by SKU (trimmed, case-insensitive). A
// matching product is updated (only the fields that actually differ); a
// missing one is inserted. Running it again changes nothing. Products not in
// the catalog are never touched (the dry run lists them).
//
// Opening stock reconciles with the movement history: openingStock is stored
// as products.brand_new (the counted stock before any recorded movement), and
// stock_quantity is recomputed as brand_new + the net of every APPROVED stock
// movement — the same rule as the 20261006000000_rebaseline_stock_quantity
// migration, kept in step afterwards by the stock-movement triggers. Pending
// and rejected movements have no stock effect and aren't counted.
//
// Location goes into the description as a "Location: ..." line (replacing
// any existing one, keeping the rest of the description).
//
// Writes go through the service-role key from .env.local — which points at
// the LIVE project (there is no separate local/staging database).
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const ROOT = process.cwd()
const CATALOG = path.join(ROOT, "scripts", "data", "inventory-catalog.json")
const BACKUP_DIR = path.join(ROOT, "scripts", "backups")
const LOG_DIR = path.join(ROOT, "scripts", "logs")

interface CatalogEntry {
  sku: string
  name: string
  category: string
  location?: string | null
  openingStock: number | null
  purchasePrice: number | null
  sellingPrice: number | null
}
interface ProductRow {
  id: string
  sku: string | null
  name: string
  category: string | null
  description: string | null
  stock_quantity: number
  brand_new: number
  purchase_price: number | null
  selling_price: number | null
  [key: string]: unknown
}
type Patch = Partial<Pick<ProductRow, "name" | "category" | "description" | "stock_quantity" | "brand_new" | "purchase_price" | "selling_price">>

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const skuKey = (sku: string | null | undefined) => (sku ?? "").trim().toLowerCase()
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")

// The description with its "Location: ..." line set to `location`.
function withLocation(description: string | null, location: string): string {
  const kept = (description ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*location\s*:/i.test(line) && line.trim() !== "")
  return [...kept, `Location: ${location}`].join("\n")
}

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data as unknown as T[]))
    if (data.length < 1000) break
  }
  return out
}

function validate(entries: CatalogEntry[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  entries.forEach((e, i) => {
    const where = `products[${i}] (${e.sku || "no SKU"})`
    if (!e.sku?.trim()) errors.push(`${where}: missing sku`)
    if (!e.name?.trim()) errors.push(`${where}: missing name`)
    if (!e.category?.trim()) errors.push(`${where}: missing category`)
    for (const f of ["openingStock", "purchasePrice", "sellingPrice"] as const) {
      const v = e[f]
      if (v !== null && v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) errors.push(`${where}: ${f} must be null or a number ≥ 0`)
    }
    if (e.openingStock != null && !Number.isInteger(e.openingStock)) errors.push(`${where}: openingStock must be a whole number`)
    const k = skuKey(e.sku)
    if (seen.has(k)) errors.push(`${where}: duplicate sku`)
    seen.add(k)
  })
  return errors
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")) as { defaults?: { location?: string }; products: CatalogEntry[] }
  const problems = validate(catalog.products)
  if (problems.length) {
    console.error("Catalog has errors — nothing was read from or written to Supabase:\n  " + problems.join("\n  "))
    process.exit(1)
  }
  const defaultLocation = catalog.defaults?.location ?? ""

  const [products, movements] = await Promise.all([
    fetchAll<ProductRow>("products", "*"),
    fetchAll<{ product_id: string | null; quantity_added: number; quantity_removed: number; status: string }>(
      "stock_movements",
      "product_id, quantity_added, quantity_removed, status"
    ),
  ])
  const netApproved = new Map<string, number>()
  for (const m of movements) {
    if (!m.product_id || m.status !== "approved") continue
    netApproved.set(m.product_id, (netApproved.get(m.product_id) ?? 0) + (m.quantity_added ?? 0) - (m.quantity_removed ?? 0))
  }
  const bySku = new Map<string, ProductRow[]>()
  for (const p of products) bySku.set(skuKey(p.sku), [...(bySku.get(skuKey(p.sku)) ?? []), p])

  const inserts: { entry: CatalogEntry; row: Record<string, unknown>; warnings: string[] }[] = []
  const updates: { entry: CatalogEntry; product: ProductRow; patch: Patch; changes: string[]; warnings: string[] }[] = []
  const unchanged: string[] = []
  const blocked: string[] = []

  for (const entry of catalog.products) {
    const location = entry.location ?? defaultLocation
    const matches = bySku.get(skuKey(entry.sku)) ?? []
    if (matches.length > 1) {
      blocked.push(`${entry.sku}: ${matches.length} products already share this SKU — fix the duplicates first`)
      continue
    }
    const warnings: string[] = []
    if (entry.purchasePrice == null) warnings.push("no purchase price")
    if (entry.sellingPrice == null) warnings.push("no selling price")

    if (matches.length === 0) {
      if (entry.openingStock == null) warnings.push("no opening stock (starts at 0)")
      const opening = entry.openingStock ?? 0
      inserts.push({
        entry,
        warnings,
        row: {
          sku: entry.sku.trim(),
          name: entry.name.trim(),
          category: entry.category.trim(),
          description: location ? withLocation(null, location) : null,
          brand_new: opening,
          // A new product has no movements yet, so stock = opening stock.
          stock_quantity: opening,
          purchase_price: entry.purchasePrice ?? 0,
          selling_price: entry.sellingPrice ?? 0,
        },
      })
      continue
    }

    const product = matches[0]
    const patch: Patch = {}
    const changes: string[] = []
    const set = <K extends keyof Patch>(key: K, value: Patch[K], label: string) => {
      if (product[key] === value) return
      patch[key] = value
      changes.push(`${label}: ${JSON.stringify(product[key])} → ${JSON.stringify(value)}`)
    }
    set("name", entry.name.trim(), "name")
    set("category", entry.category.trim(), "category")
    if (location) set("description", withLocation(product.description, location), "description")
    if (entry.purchasePrice != null) set("purchase_price", entry.purchasePrice, "purchase_price")
    if (entry.sellingPrice != null) set("selling_price", entry.sellingPrice, "selling_price")
    // Stock is only recomputed from a supplied opening count. Without one the
    // current stock is kept — a stored brand_new can be stale (e.g. an old
    // import) — and any disagreement is reported for a human to resolve.
    const net = netApproved.get(product.id) ?? 0
    if (entry.openingStock != null) {
      set("brand_new", entry.openingStock, "brand_new (opening stock)")
      const stock = entry.openingStock + net
      set("stock_quantity", stock, "stock_quantity (opening + approved movements)")
      if (stock < 0) warnings.push(`stock would be ${stock} — approved movements exceed the opening stock`)
    } else {
      const expected = product.brand_new + net
      if (expected !== product.stock_quantity)
        warnings.push(`stock ${product.stock_quantity} ≠ stored opening ${product.brand_new} + approved movements ${net} (= ${expected}); left as is — set openingStock to reconcile`)
      else if (product.stock_quantity < 0) warnings.push(`stock is ${product.stock_quantity} — set openingStock to reconcile`)
    }
    if (changes.length) updates.push({ entry, product, patch, changes, warnings })
    else unchanged.push(entry.sku)
  }

  const catalogSkus = new Set(catalog.products.map((e) => skuKey(e.sku)))
  const untouched = products.filter((p) => !catalogSkus.has(skuKey(p.sku))).map((p) => `${p.sku} ${p.name}`)

  // ---- report
  console.log(`\n${APPLY ? "APPLY" : "DRY RUN — nothing is written to Supabase"} · ${env.NEXT_PUBLIC_SUPABASE_URL.replace(/^https:\/\/([a-z0-9]{6})[a-z0-9]*/, "https://$1…")} (live project)`)
  console.log(`catalog ${catalog.products.length} · existing products ${products.length} · insert ${inserts.length} · update ${updates.length} · unchanged ${unchanged.length} · blocked ${blocked.length}`)
  if (inserts.length) {
    console.log("\nINSERT")
    console.table(inserts.map(({ row, warnings }) => ({ sku: row.sku, name: row.name, category: row.category, opening: row.brand_new, stock: row.stock_quantity, buy: row.purchase_price, sell: row.selling_price, warnings: warnings.join("; ") })))
  }
  if (updates.length) {
    console.log("\nUPDATE")
    for (const u of updates) console.log(`  ${u.entry.sku.padEnd(7)} ${u.product.name}\n    ${u.changes.join("\n    ")}${u.warnings.length ? `\n    ⚠ ${u.warnings.join("; ")}` : ""}`)
  }
  if (blocked.length) console.log("\nBLOCKED\n  " + blocked.join("\n  "))
  if (untouched.length) console.log("\nNot in catalog (left as is): " + untouched.join(", "))
  const missingPrices = [...inserts, ...updates].filter((x) => x.warnings.some((w) => w.includes("price"))).length
  const missingOpening = inserts.filter((x) => x.warnings.some((w) => w.includes("opening"))).length
  if (missingPrices || missingOpening) console.log(`\n⚠ ${missingPrices} item(s) without prices, ${missingOpening} new item(s) without opening stock — fill them in ${path.relative(ROOT, CATALOG)} before applying.`)

  fs.mkdirSync(LOG_DIR, { recursive: true })
  const logFile = path.join(LOG_DIR, `populate-inventory-${APPLY ? "apply" : "dry-run"}-${stamp()}.json`)
  fs.writeFileSync(
    logFile,
    JSON.stringify(
      { mode: APPLY ? "apply" : "dry-run", at: new Date().toISOString(), inserts: inserts.map(({ row, warnings }) => ({ ...row, warnings })), updates: updates.map(({ product, patch, changes, warnings }) => ({ id: product.id, sku: product.sku, patch, changes, warnings })), unchanged, blocked, untouched },
      null,
      2
    )
  )
  console.log(`\nLog: ${path.relative(ROOT, logFile)}`)

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply to write (a backup of every product is saved first).")
    return
  }
  if (blocked.length) {
    console.error("\nNot applying: resolve the BLOCKED SKUs first.")
    process.exit(1)
  }

  // ---- backup, then write
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const backupFile = path.join(BACKUP_DIR, `products-backup-${stamp()}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(products, null, 2))
  console.log(`\nBackup: ${path.relative(ROOT, backupFile)} (${products.length} products)`)

  let inserted = 0
  let updated = 0
  for (const { row } of inserts) {
    const { error } = await supabase.from("products").insert(row)
    if (error) throw new Error(`insert ${row.sku}: ${error.message}`)
    inserted++
  }
  for (const { product, patch } of updates) {
    const { error } = await supabase.from("products").update(patch).eq("id", product.id)
    if (error) throw new Error(`update ${product.sku}: ${error.message}`)
    updated++
  }
  console.log(`Done: ${inserted} inserted, ${updated} updated. Run the dry run again to confirm it now reports no changes.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
