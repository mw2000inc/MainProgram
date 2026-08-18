"use client"

import * as React from "react"
import { Send, Pencil, Trash2, X, Check } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useAddComment, useComments, useDeleteComment, useUpdateComment } from "@/lib/hooks/use-announcements"
import { useAuth } from "@/lib/auth/auth-context"
import { formatDateTime, initials } from "@/lib/utils"

export function CommentThread({ announcementId }: { announcementId: string }) {
  const { user } = useAuth()
  const { data: comments = [], isPending } = useComments(announcementId)
  const addComment = useAddComment(announcementId, user?.id ?? "")
  const updateComment = useUpdateComment(announcementId)
  const deleteComment = useDeleteComment(announcementId)

  const [draft, setDraft] = React.useState("")
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editDraft, setEditDraft] = React.useState("")
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  async function submitComment() {
    const body = draft.trim()
    if (!body) return
    await addComment.mutateAsync(body)
    setDraft("")
  }

  async function submitEdit(id: string) {
    const body = editDraft.trim()
    if (!body) return
    await updateComment.mutateAsync({ id, body })
    setEditingId(null)
  }

  return (
    <div className="space-y-3 border-t pt-3 mt-3">
      {!isPending && comments.length === 0 && (
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      )}
      {comments.map((c) => {
        const canModify = c.authorId === user?.id
        const canDelete = canModify || user?.role === "admin"
        const isEditing = editingId === c.id
        return (
          <div key={c.id} className="flex items-start gap-2.5">
            <Avatar size="sm">
              <AvatarFallback>{initials(c.authorName)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{c.authorName}</span>
                <span className="text-[11px] text-muted-foreground">{formatDateTime(c.createdAt)}</span>
              </div>
              {isEditing ? (
                <div className="mt-1 space-y-1.5">
                  <Textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={2}
                    className="text-sm"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => submitEdit(c.id)}>
                      <Check className="h-3 w-3" /> Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-xs"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-3 w-3" /> Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm leading-snug mt-0.5">{c.body}</p>
              )}
              {!isEditing && (canModify || canDelete) && (
                <div className="flex items-center gap-2 mt-1">
                  {canModify && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      onClick={() => {
                        setEditingId(c.id)
                        setEditDraft(c.body)
                      }}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                  {canDelete && (
                    <button
                      className="text-[11px] text-muted-foreground hover:text-danger inline-flex items-center gap-1"
                      onClick={() => setDeletingId(c.id)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div className="flex items-start gap-2.5">
        <Avatar size="sm">
          <AvatarFallback>{initials(user?.name ?? "")}</AvatarFallback>
        </Avatar>
        <div className="flex-1 flex items-center gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a comment..."
            rows={1}
            className="text-sm min-h-9 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submitComment()
              }
            }}
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            disabled={!draft.trim() || addComment.isPending}
            onClick={submitComment}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(o) => !o && setDeletingId(null)}
        title="Delete comment?"
        description="This will permanently remove this comment."
        loading={deleteComment.isPending}
        onConfirm={async () => {
          if (!deletingId) return
          await deleteComment.mutateAsync(deletingId)
          setDeletingId(null)
        }}
      />
    </div>
  )
}
