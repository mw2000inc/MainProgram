import { addDays, format, parseISO } from "date-fns"
import { supabase } from "@/lib/supabase/client"
import { businessToday } from "@/lib/dispatch-lead-time"
import type { Announcement, AnnouncementComment } from "@/lib/types"

type AnnouncementRow = {
  id: string
  title: string
  body: string
  // Absent until the 20261110000000_announcement_date migration is applied.
  announcement_date?: string | null
  created_by: string
  created_at: string
  updated_at: string
}

type CommentRow = {
  id: string
  announcement_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
  author: { name: string } | null
}

function fromRow(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    announcementDate: row.announcement_date ?? businessToday(new Date(row.created_at)),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function commentFromRow(row: CommentRow): AnnouncementComment {
  return {
    id: row.id,
    announcementId: row.announcement_id,
    authorId: row.author_id,
    authorName: row.author?.name ?? "Unknown",
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// announcement_date not there yet (migration not applied): 42703 from a
// filter, PGRST204 from an insert/update naming it.
function isMissingDateColumn(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === "42703" || error.code === "PGRST204") && /announcement_date/.test(error.message ?? "")
}

export type AnnouncementInput = { title: string; body: string; announcementDate?: string }

// Newest first. With a date (yyyy-MM-dd): only that day's announcements —
// before the migration, the ones posted that day (Manila time).
export async function listAnnouncements(date?: string): Promise<Announcement[]> {
  const base = () => supabase.from("announcements").select("*").order("created_at", { ascending: false })
  if (!date) {
    const { data, error } = await base()
    if (error) throw error
    return (data as AnnouncementRow[]).map(fromRow)
  }
  const { data, error } = await base().eq("announcement_date", date)
  if (!error) return (data as AnnouncementRow[]).map(fromRow)
  if (!isMissingDateColumn(error)) throw error
  const next = format(addDays(parseISO(date), 1), "yyyy-MM-dd")
  const fallback = await base().gte("created_at", `${date}T00:00:00+08:00`).lt("created_at", `${next}T00:00:00+08:00`)
  if (fallback.error) throw fallback.error
  return (fallback.data as AnnouncementRow[]).map(fromRow)
}

function toRow(input: AnnouncementInput, withDate: boolean) {
  return { title: input.title, body: input.body, ...(withDate && input.announcementDate ? { announcement_date: input.announcementDate } : {}) }
}

export async function createAnnouncement(input: AnnouncementInput): Promise<Announcement> {
  let result = await supabase.from("announcements").insert(toRow(input, true)).select().single()
  if (isMissingDateColumn(result.error)) result = await supabase.from("announcements").insert(toRow(input, false)).select().single()
  if (result.error) throw result.error
  return fromRow(result.data as AnnouncementRow)
}

export async function updateAnnouncement(id: string, input: AnnouncementInput): Promise<Announcement> {
  const run = (withDate: boolean) =>
    supabase
      .from("announcements")
      .update({ ...toRow(input, withDate), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()
  let result = await run(true)
  if (isMissingDateColumn(result.error)) result = await run(false)
  if (result.error) throw result.error
  return fromRow(result.data as AnnouncementRow)
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from("announcements").delete().eq("id", id)
  if (error) throw error
}

export async function listComments(announcementId: string): Promise<AnnouncementComment[]> {
  const { data, error } = await supabase
    .from("announcement_comments")
    .select("*, author:profiles(name)")
    .eq("announcement_id", announcementId)
    .order("created_at", { ascending: true })
  if (error) throw error
  return (data as unknown as CommentRow[]).map(commentFromRow)
}

export async function addComment(announcementId: string, body: string, authorId: string): Promise<AnnouncementComment> {
  const { data, error } = await supabase
    .from("announcement_comments")
    .insert({ announcement_id: announcementId, author_id: authorId, body })
    .select("*, author:profiles(name)")
    .single()
  if (error) throw error
  return commentFromRow(data as unknown as CommentRow)
}

export async function updateComment(id: string, body: string): Promise<AnnouncementComment> {
  const { data, error } = await supabase
    .from("announcement_comments")
    .update({ body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, author:profiles(name)")
    .single()
  if (error) throw error
  return commentFromRow(data as unknown as CommentRow)
}

export async function deleteComment(id: string): Promise<void> {
  const { error } = await supabase.from("announcement_comments").delete().eq("id", id)
  if (error) throw error
}
