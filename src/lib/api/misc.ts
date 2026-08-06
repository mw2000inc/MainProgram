import { supabase } from "@/lib/supabase/client"
import { logActivity } from "@/lib/api/activity"
import type { AppNotification, CompanySettings, ContactEntry, User } from "@/lib/types"

type ProfileRow = {
  id: string
  name: string
  email: string
  role: User["role"]
  avatar_url: string | null
  phone: string | null
  created_at: string
}

function userFromRow(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url ?? undefined,
    phone: row.phone ?? undefined,
    createdAt: row.created_at,
  }
}

export async function listUsers(): Promise<User[]> {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false })
  if (error) throw error
  return (data as ProfileRow[]).map(userFromRow)
}

// Creating a user with a password requires the service-role key, so this goes
// through a server route rather than a direct client-side insert.
export async function createUser(
  input: { name: string; email: string; role: User["role"]; password: string },
  actorId: string
): Promise<User> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const { error } = await res.json()
    throw new Error(error ?? "Failed to create user")
  }
  const { id } = await res.json()
  await logActivity(actorId, "User Created")
  const { data } = await supabase.from("profiles").select("*").eq("id", id).single()
  return userFromRow(data as ProfileRow)
}

export async function updateUser(
  id: string,
  input: Partial<Pick<User, "name" | "email" | "role" | "avatarUrl" | "phone">>,
  actorId: string
): Promise<User> {
  const row: Record<string, unknown> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.email !== undefined) row.email = input.email
  if (input.role !== undefined) row.role = input.role
  if (input.avatarUrl !== undefined) row.avatar_url = input.avatarUrl || null
  if (input.phone !== undefined) row.phone = input.phone || null

  const { data, error } = await supabase.from("profiles").update(row).eq("id", id).select().single()
  if (error) throw error
  await logActivity(actorId, "User Edited")
  return userFromRow(data as ProfileRow)
}

export async function deleteUser(id: string, actorId: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" })
  if (!res.ok) {
    const { error } = await res.json()
    throw new Error(error ?? "Failed to delete user")
  }
  await logActivity(actorId, "User Deleted")
}

type NotificationRow = {
  id: string
  type: AppNotification["type"]
  message: string
  is_read: boolean
  created_at: string
  related_entity_id: string | null
}

export async function listNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) throw error
  return (data as NotificationRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
    relatedEntityId: row.related_entity_id ?? undefined,
  }))
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("id", id)
  if (error) throw error
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.from("notifications").update({ is_read: true }).eq("is_read", false)
  if (error) throw error
}

type SettingsRow = {
  company_name: string
  company_logo_url: string | null
  support_email: string
  email_notifications_enabled: boolean
  currency: string
  tax_rate: number
  address: string
  contact_numbers: ContactEntry[]
  contact_emails: ContactEntry[]
  // Added by the monitoring-intervals migration; read defensively so the app
  // keeps working against a database that hasn't run the migration yet.
  monitoring_default_months?: number | null
  monitoring_intervals?: Record<string, number> | null
}

function settingsFromRow(row: SettingsRow): CompanySettings {
  return {
    companyName: row.company_name,
    companyLogoUrl: row.company_logo_url ?? undefined,
    supportEmail: row.support_email,
    emailNotificationsEnabled: row.email_notifications_enabled,
    currency: row.currency,
    taxRate: Number(row.tax_rate),
    address: row.address,
    contactNumbers: row.contact_numbers,
    contactEmails: row.contact_emails,
    monitoringDefaultMonths: row.monitoring_default_months ?? 6,
    monitoringIntervals: row.monitoring_intervals ?? {},
  }
}

export async function getSettings(): Promise<CompanySettings> {
  const { data, error } = await supabase.from("company_settings").select("*").eq("id", 1).single()
  if (error) throw error
  return settingsFromRow(data as SettingsRow)
}

export async function updateSettings(input: Partial<CompanySettings>, actorId: string): Promise<CompanySettings> {
  const row: Record<string, unknown> = {}
  if (input.companyName !== undefined) row.company_name = input.companyName
  if (input.companyLogoUrl !== undefined) row.company_logo_url = input.companyLogoUrl || null
  if (input.supportEmail !== undefined) row.support_email = input.supportEmail
  if (input.emailNotificationsEnabled !== undefined) row.email_notifications_enabled = input.emailNotificationsEnabled
  if (input.currency !== undefined) row.currency = input.currency
  if (input.taxRate !== undefined) row.tax_rate = input.taxRate
  if (input.address !== undefined) row.address = input.address
  if (input.contactNumbers !== undefined) row.contact_numbers = input.contactNumbers
  if (input.contactEmails !== undefined) row.contact_emails = input.contactEmails
  if (input.monitoringDefaultMonths !== undefined) row.monitoring_default_months = input.monitoringDefaultMonths
  if (input.monitoringIntervals !== undefined) row.monitoring_intervals = input.monitoringIntervals

  const { data, error } = await supabase.from("company_settings").update(row).eq("id", 1).select().single()
  if (error) throw error
  await logActivity(actorId, "Settings Updated")
  return settingsFromRow(data as SettingsRow)
}
