import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/announcements"
import { toast } from "sonner"

export const announcementsKey = ["announcements"] as const
export const commentsKey = (announcementId: string) => ["announcementComments", announcementId] as const

// With a date: that day's announcements only, cached per date — changing the
// Daily Report date fetches the new day. Every write invalidates them all
// (announcementsKey is the prefix).
export function useAnnouncements(date?: string) {
  return useQuery({
    queryKey: date ? [...announcementsKey, date] : announcementsKey,
    queryFn: () => api.listAnnouncements(date),
  })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: api.AnnouncementInput) => api.createAnnouncement(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementsKey })
      toast.success("Announcement posted")
    },
    onError: () => toast.error("Failed to post announcement"),
  })
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.AnnouncementInput }) => api.updateAnnouncement(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementsKey })
      toast.success("Announcement updated")
    },
    onError: () => toast.error("Failed to update announcement"),
  })
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAnnouncement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: announcementsKey })
      toast.success("Announcement deleted")
    },
    onError: () => toast.error("Failed to delete announcement"),
  })
}

export function useComments(announcementId: string) {
  return useQuery({
    queryKey: commentsKey(announcementId),
    queryFn: () => api.listComments(announcementId),
  })
}

export function useAddComment(announcementId: string, actorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: string) => api.addComment(announcementId, body, actorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(announcementId) }),
    onError: () => toast.error("Failed to add comment"),
  })
}

export function useUpdateComment(announcementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.updateComment(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(announcementId) }),
    onError: () => toast.error("Failed to update comment"),
  })
}

export function useDeleteComment(announcementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(announcementId) }),
    onError: () => toast.error("Failed to delete comment"),
  })
}
