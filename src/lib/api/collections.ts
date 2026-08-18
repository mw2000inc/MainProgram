import { supabase } from "@/lib/supabase/client"
import type { CollectionPlan } from "@/lib/types"

type Row = {
  id: string
  order_no: string
  account_name: string
  collection_date: string
  amount: number
  status: string
  c_t: string
  pre_d: string | null
  acc_d: string | null
  note: string | null
  created_at: string
}

function fromRow(row: Row): CollectionPlan {
  return {
    id: row.id,
    orderNo: row.order_no,
    accountName: row.account_name,
    collectionDate: row.collection_date,
    amount: row.amount,
    status: row.status,
    ct: row.c_t,
    preD: row.pre_d ?? undefined,
    accD: row.acc_d ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  }
}

function toRow(input: Partial<Omit<CollectionPlan, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.orderNo !== undefined) row.order_no = input.orderNo
  if (input.accountName !== undefined) row.account_name = input.accountName
  if (input.collectionDate !== undefined) row.collection_date = input.collectionDate
  if (input.amount !== undefined) row.amount = input.amount
  if (input.status !== undefined) row.status = input.status
  if (input.ct !== undefined) row.c_t = input.ct
  if (input.preD !== undefined) row.pre_d = input.preD || null
  if (input.accD !== undefined) row.acc_d = input.accD || null
  if (input.note !== undefined) row.note = input.note || null
  return row
}

export async function listCollections(): Promise<CollectionPlan[]> {
  const { data, error } = await supabase.from("collections").select("*").order("collection_date", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createCollection(input: Omit<CollectionPlan, "id" | "createdAt">): Promise<CollectionPlan> {
  const { data, error } = await supabase.from("collections").insert(toRow(input)).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function updateCollection(id: string, input: Partial<Omit<CollectionPlan, "id" | "createdAt">>): Promise<CollectionPlan> {
  const { data, error } = await supabase.from("collections").update(toRow(input)).eq("id", id).select().single()
  if (error) throw error
  return fromRow(data as Row)
}

export async function deleteCollection(id: string): Promise<void> {
  const { error } = await supabase.from("collections").delete().eq("id", id)
  if (error) throw error
}

export async function deleteCollections(ids: string[]): Promise<void> {
  const { error } = await supabase.from("collections").delete().in("id", ids)
  if (error) throw error
}
