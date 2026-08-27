import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/announcements"
import { toast } from "sonner"

export const announcementsKey = ["announcements"] as const
export const commentsKey = (announcementId: string) => ["announcementComments", announcementId] as const

export function useAnnouncements() {
  return useQuery({ queryKey: announcementsKey, queryFn: api.listAnnouncements })
}

export function useCreateAnnouncement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { title: string; body: string }) => api.createAnnouncement(input),
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
    mutationFn: ({ id, input }: { id: string; input: { title: string; body: string } }) => api.updateAnnouncement(id, input),
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
