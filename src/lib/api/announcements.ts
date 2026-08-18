import { supabase } from "@/lib/supabase/client"
import type { Announcement, AnnouncementComment } from "@/lib/types"

type AnnouncementRow = {
  id: string
  title: string
  body: string
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

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data as AnnouncementRow[]).map(fromRow)
}

export async function createAnnouncement(input: { title: string; body: string }, actorId: string): Promise<Announcement> {
  const { data, error } = await supabase
    .from("announcements")
    .insert({ title: input.title, body: input.body, created_by: actorId })
    .select()
    .single()
  if (error) throw error
  return fromRow(data as AnnouncementRow)
}

export async function updateAnnouncement(id: string, input: { title: string; body: string }): Promise<Announcement> {
  const { data, error } = await supabase
    .from("announcements")
    .update({ title: input.title, body: input.body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()
  if (error) throw error
  return fromRow(data as AnnouncementRow)
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
