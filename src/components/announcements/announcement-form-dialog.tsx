"use client"

import * as React from "react"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { useAuth } from "@/lib/auth/auth-context"
import { useCreateAnnouncement, useUpdateAnnouncement } from "@/lib/hooks/use-announcements"
import type { Announcement } from "@/lib/types"

const schema = z.object({
  title: z.string().min(2, "Title is required"),
  body: z.string().min(2, "Message is required"),
})

type FormValues = z.infer<typeof schema>

export function AnnouncementFormDialog({
  open,
  onOpenChange,
  announcement,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  announcement?: Announcement
}) {
  const { user } = useAuth()
  const createAnnouncement = useCreateAnnouncement(user?.id ?? "")
  const updateAnnouncement = useUpdateAnnouncement()
  const isEdit = !!announcement

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: announcement?.title ?? "", body: announcement?.body ?? "" },
  })

  React.useEffect(() => {
    if (open) form.reset({ title: announcement?.title ?? "", body: announcement?.body ?? "" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, announcement])

  async function onSubmit(values: FormValues) {
    if (isEdit) {
      await updateAnnouncement.mutateAsync({ id: announcement.id, input: values })
    } else {
      await createAnnouncement.mutateAsync(values)
    }
    onOpenChange(false)
  }

  const pending = createAnnouncement.isPending || updateAnnouncement.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Announcement" : "Post Announcement"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this announcement." : "Share an update with the whole team."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. New delivery schedule" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea rows={4} placeholder="Write the announcement..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving..." : isEdit ? "Save Changes" : "Post"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
