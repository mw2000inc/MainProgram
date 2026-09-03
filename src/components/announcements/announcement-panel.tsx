"use client"

import * as React from "react"
import { Megaphone, Plus, Pencil, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { AnnouncementFormDialog } from "@/components/announcements/announcement-form-dialog"
import { CommentThread } from "@/components/announcements/comment-thread"
import { TranslatableText } from "@/components/shared/translatable-text"
import { useDragHandle } from "@/components/dashboard/sortable-panel"
import { useAnnouncements, useDeleteAnnouncement } from "@/lib/hooks/use-announcements"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { cn, formatDateTime } from "@/lib/utils"
import type { Announcement } from "@/lib/types"

export function AnnouncementPanel({ title = "Announcements" }: { title?: string } = {}) {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const dragHandle = useDragHandle()
  const { t } = useTranslation("announcements")
  const { data: announcements = [], isPending } = useAnnouncements()
  const deleteAnnouncement = useDeleteAnnouncement()

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<Announcement | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<Announcement | undefined>(undefined)

  return (
    <Card className="h-full flex flex-col">
      <CardHeader
        {...dragHandle}
        className={cn(
          "flex min-w-0 max-w-full flex-col items-stretch gap-2 @sm/card-header:flex-row @sm/card-header:items-center @sm/card-header:justify-between",
          dragHandle && "touch-none cursor-grab select-none active:cursor-grabbing"
        )}
      >
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 shrink-0 text-primary" /> <span className="truncate">{title}</span>
        </CardTitle>
        {isAdmin && (
          <Button
            size="sm"
            className="w-full shrink-0 gap-1.5 @sm/card-header:w-auto"
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" /> {t("newAnnouncement")}
          </Button>
        )}
      </CardHeader>
      {/* flex-1 (not a hardcoded max-h-[520px]) — fills exactly whatever
          height this panel is resized to and scrolls internally past that,
          instead of always capping out at the same fixed height regardless
          of the panel's actual size. */}
      <CardContent className="flex-1 flex flex-col space-y-5 overflow-y-auto">
        {isPending && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}
        {!isPending && announcements.length === 0 && (
          <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground text-center">
            {t("noAnnouncementsYet")}
          </p>
        )}
        {announcements.map((a, i) => (
          <div key={a.id}>
            {i > 0 && <Separator className="mb-5" />}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{a.title}</h3>
                <TranslatableText
                  entityType="announcements"
                  entityId={a.id}
                  fieldName="body"
                  text={a.body}
                  className="text-sm text-muted-foreground whitespace-pre-wrap mt-0.5"
                />
                <p className="text-[11px] text-muted-foreground mt-1">{formatDateTime(a.createdAt)}</p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setEditing(a)
                      setFormOpen(true)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-danger hover:text-danger"
                    onClick={() => setDeleting(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
            <CommentThread announcementId={a.id} />
          </div>
        ))}
      </CardContent>

      <AnnouncementFormDialog open={formOpen} onOpenChange={setFormOpen} announcement={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("deleteAnnouncement")}
        description={t("deleteAnnouncementDescription")}
        loading={deleteAnnouncement.isPending}
        onConfirm={async () => {
          if (!deleting) return
          await deleteAnnouncement.mutateAsync(deleting.id)
          setDeleting(undefined)
        }}
      />
    </Card>
  )
}
