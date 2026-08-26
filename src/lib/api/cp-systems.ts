import { supabase } from "@/lib/supabase/client"
import type { CpSystem, CpSystemComponent } from "@/lib/types"

type Row = {
  id: string
  system_code: string
  components: CpSystemComponent[]
  created_at: string
}

function fromRow(row: Row): CpSystem {
  return {
    id: row.id,
    systemCode: row.system_code,
    components: row.components ?? [],
    createdAt: row.created_at,
  }
}

function toRow(input: Partial<Omit<CpSystem, "id" | "createdAt">>) {
  const row: Record<string, unknown> = {}
  if (input.systemCode !== undefined) row.system_code = input.systemCode
  if (input.components !== undefined) row.components = input.components
  return row
}

export async function listCpSystems(): Promise<CpSystem[]> {
  const { data, error } = await supabase.from("cp_systems").select("*").order("system_code", { ascending: true })
  if (error) throw error
  return (data as Row[]).map(fromRow)
}

export async function createCpSystem(input: Omit<CpSystem, "id" | "createdAt">): Promise<CpSystem> {
  const { data, error } = await supabase.from("cp_systems").insert(toRow(input)).select().single()
  if (error) {
    if (error.code === "23505") {
      throw new Error("That system code already exists.")
    }
    throw error
  }
  return fromRow(data as Row)
}

export async function updateCpSystem(id: string, input: Partial<Omit<CpSystem, "id" | "createdAt">>): Promise<CpSystem> {
  const { data, error } = await supabase.from("cp_systems").update(toRow(input)).eq("id", id).select().single()
  if (error) {
    if (error.code === "23505") {
      throw new Error("That system code already exists.")
    }
    throw error
  }
  return fromRow(data as Row)
}

export async function deleteCpSystem(id: string): Promise<void> {
  const { error } = await supabase.from("cp_systems").delete().eq("id", id)
  if (error) throw error
}
