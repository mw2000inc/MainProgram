// Links pending stock movements that have no product (product_id is null) to
// the product they name, so they can be approved instead of waiting in the
// Review queue for a manual pick. Typical case: an install recorded before its
// purifier model existed in products (queue_install_inventory() found no SKU
// then and left product_id empty).
//
//   Dry run (default — reads only, writes nothing):
//     npx tsx scripts/link-pending-inventory.ts
//   Apply (backs up the affected movements first, then writes):
//     npx tsx scripts/link-pending-inventory.ts --apply
//
// Matching is exact, never fuzzy — a wrong product would deduct the wrong
// stock on approval:
//   1. the code before " / " in the movement's item label equals a product
//      SKU ("106 / MW) Oasis-S2" → SKU 106), the same rule the install and
//      filter-change triggers use;
//   2. otherwise the whole label equals a product name (case and spacing
//      ignored).
// Anything else, or a code shared by two products, is reported and left
// alone. Only product_id is set; status stays 'pending'. The stock triggers
// act only on approved movements, so linking changes no stock — approving
// does, exactly as for any other pending item. Running it again finds
// nothing left to link.
import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const ROOT = process.cwd()
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
)
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase()
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")

interface Movement {
  id: string
  date: string
  item_label: string | null
  quantity_added: number
  quantity_removed: number
  status: string
  product_id: string | null
  reference_number: string | null
  [key: string]: unknown
}

async function main() {
  const [{ data: products, error: pErr }, { data: movements, error: mErr }] = await Promise.all([
    supabase.from("products").select("id, sku, name, stock_quantity"),
    supabase.from("stock_movements").select("*").eq("status", "pending").is("product_id", null).order("date"),
  ])
  if (pErr) throw new Error(`products: ${pErr.message}`)
  if (mErr) throw new Error(`stock_movements: ${mErr.message}`)

  const bySku = new Map<string, { id: string; sku: string; name: string; stock_quantity: number }[]>()
  const byName = new Map<string, { id: string; sku: string; name: string; stock_quantity: number }[]>()
  for (const p of products ?? []) {
    bySku.set(norm(p.sku), [...(bySku.get(norm(p.sku)) ?? []), p])
    byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p])
  }

  const links: { movement: Movement; product: { id: string; sku: string; name: string; stock_quantity: number }; how: string }[] = []
  const unmatched: { movement: Movement; reason: string }[] = []
  for (const m of (movements ?? []) as Movement[]) {
    const label = m.item_label ?? ""
    const code = label.includes(" / ") ? label.split(" / ")[0] : label
    const skuHits = bySku.get(norm(code)) ?? []
    const nameHits = byName.get(norm(label)) ?? []
    if (skuHits.length === 1) links.push({ movement: m, product: skuHits[0], how: `SKU ${skuHits[0].sku}` })
    else if (skuHits.length > 1) unmatched.push({ movement: m, reason: `${skuHits.length} products share SKU "${code.trim()}"` })
    else if (nameHits.length === 1) links.push({ movement: m, product: nameHits[0], how: "name" })
    else unmatched.push({ movement: m, reason: label ? "no product with that SKU or name" : "no item label" })
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN — nothing is written"} · pending movements without a product: ${(movements ?? []).length} · link ${links.length} · unmatched ${unmatched.length}`)
  if (links.length) {
    console.table(
      links.map(({ movement: m, product: p, how }) => ({
        date: m.date,
        label: m.item_label,
        qty: m.quantity_removed ? `-${m.quantity_removed}` : `+${m.quantity_added}`,
        ref: m.reference_number ?? "",
        "→ product": p.name,
        match: how,
        "stock now": p.stock_quantity,
      }))
    )
  }
  if (unmatched.length) console.log("Left alone:\n  " + unmatched.map(({ movement: m, reason }) => `${m.date} "${m.item_label}" — ${reason}`).join("\n  "))

  // Approving these later deducts stock; flag products that would go below 0.
  const deduct = new Map<string, number>()
  for (const { movement: m, product: p } of links) deduct.set(p.id, (deduct.get(p.id) ?? 0) + (m.quantity_removed ?? 0) - (m.quantity_added ?? 0))
  const short = [...deduct].map(([id, d]) => ({ p: (products ?? []).find((x) => x.id === id)!, d })).filter(({ p, d }) => p.stock_quantity - d < 0)
  if (short.length) console.log("\n⚠ Approving all of these would take stock below 0 for: " + short.map(({ p, d }) => `${p.name} (${p.stock_quantity} → ${p.stock_quantity - d})`).join(", "))

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply to link them (a backup of these movements is saved first).")
    return
  }
  if (links.length === 0) return

  const backupDir = path.join(ROOT, "scripts", "backups")
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, `stock-movements-link-backup-${stamp()}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(links.map((l) => l.movement), null, 2))
  console.log(`\nBackup: ${path.relative(ROOT, backupFile)} (${links.length} movements, before linking)`)

  let linked = 0
  for (const { movement: m, product: p } of links) {
    const { data, error } = await supabase
      .from("stock_movements")
      .update({ product_id: p.id })
      .eq("id", m.id)
      .eq("status", "pending") // approved/rejected meanwhile → left alone
      .is("product_id", null) // linked by someone else meanwhile → left alone
      .select("id")
    if (error) throw new Error(`${m.id}: ${error.message}`)
    if (data?.length) linked++
  }
  console.log(`Done: ${linked} of ${links.length} linked (still pending). Run again to confirm nothing is left to link.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
