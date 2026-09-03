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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCreateUser, useUpdateUser } from "@/lib/hooks/use-misc"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { User } from "@/lib/types"

function createSchema(t: (key: string, params?: Record<string, string>) => string, tf: (key: string) => string) {
  return z.object({
    name: z.string().min(2, t("requiredField", { field: tf("fullName") })),
    email: z.string().email(t("enterValidField", { field: tf("email") })),
    role: z.enum(["admin", "technician"]),
    password: z.string(),
  })
}

type FormValues = z.infer<ReturnType<typeof createSchema>>

function defaultValues(user?: User): FormValues {
  return {
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "technician",
    password: "",
  }
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: User
}) {
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const isEdit = !!user
  const { t } = useTranslation("users")
  const { t: tCommon } = useTranslation("common")
  const { t: tFields } = useTranslation("fields")
  const schema = React.useMemo(() => createSchema(tCommon, tFields), [tCommon, tFields])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(user),
  })

  React.useEffect(() => {
    if (open) form.reset(defaultValues(user))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user])

  async function onSubmit(values: FormValues) {
    const { password, ...rest } = values
    if (isEdit) {
      await updateUser.mutateAsync({ id: user.id, input: rest })
    } else {
      if (password.length < 6) {
        form.setError("password", { message: t("passwordMinLength") })
        return
      }
      await createUser.mutateAsync({ ...rest, password })
    }
    onOpenChange(false)
  }

  const pending = createUser.isPending || updateUser.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{isEdit ? t("editDescription") : t("addDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("fullName")}</FormLabel>
                  <FormControl>
                    <Input placeholder="Juan Dela Cruz" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("emailAddress")}</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="juan@aquatrack.ph" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {!isEdit && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("password")}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tFields("role")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={t("selectRole")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">{tCommon("admin")}</SelectItem>
                      <SelectItem value="technician">{tCommon("technician")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? tCommon("saving") : isEdit ? tCommon("saveChanges") : t("addUser")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
