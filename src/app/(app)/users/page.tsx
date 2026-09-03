"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Plus, UserCog } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/data-table/data-table"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { AdminGuard } from "@/components/shared/admin-guard"
import { UserFormDialog } from "@/components/users/user-form-dialog"
import { getUsersColumns } from "@/components/users/users-columns"
import { useDeleteUser, useUsers } from "@/lib/hooks/use-misc"
import { useDeepLinkNotFoundToast } from "@/lib/hooks/use-deep-link-not-found"
import { useAuth } from "@/lib/auth/auth-context"
import { useTranslation } from "@/lib/i18n/i18n-context"
import type { User } from "@/lib/types"

function UsersContent() {
  const { user: actor } = useAuth()
  const { t } = useTranslation("users")
  const { t: tNav } = useTranslation("nav")
  const { data: users = [], isPending } = useUsers()
  const deleteUser = useDeleteUser()

  // Deep link from the Activity Log (?id=<userId>) — opens that user's edit
  // dialog directly, the only "view" a profile has in this app.
  const searchParams = useSearchParams()
  const initialId = searchParams.get("id") ?? undefined
  const openedInitialRef = React.useRef(false)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<User | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<User | undefined>(undefined)

  useDeepLinkNotFoundToast(initialId, isPending, users.some((u) => u.id === initialId))

  React.useEffect(() => {
    if (!initialId || isPending || openedInitialRef.current) return
    const match = users.find((u) => u.id === initialId)
    if (!match) return
    openedInitialRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing(match)
    setFormOpen(true)
  }, [initialId, isPending, users])

  const columns = React.useMemo(
    () =>
      getUsersColumns({
        currentUserId: actor?.id,
        onEdit: (u) => {
          setEditing(u)
          setFormOpen(true)
        },
        onDelete: (u) => setDeleting(u),
      }),
    [actor?.id]
  )

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <AdminGuard>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <UserCog className="h-6 w-6 text-primary" /> {tNav("users")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
          </div>
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> {t("addUser")}
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={users}
              searchPlaceholder={t("searchByNameOrEmail")}
              emptyMessage={t("noUsersFound")}
            />
          </CardContent>
        </Card>

        <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />

        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(undefined)}
          title={t("deleteUserTitle")}
          description={t("deleteUserDescription", { name: deleting?.name ?? t("thisUser") })}
          loading={deleteUser.isPending}
          onConfirm={async () => {
            if (!deleting) return
            // The mutation's onError already toasts the reason — catch here so that
            // rejection doesn't also surface as an unhandled-error dev overlay.
            try {
              await deleteUser.mutateAsync(deleting.id)
              setDeleting(undefined)
            } catch {
              // handled by the mutation's onError toast
            }
          }}
        />
      </div>
    </AdminGuard>
  )
}

function UsersFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

export default function UsersPage() {
  return (
    <React.Suspense fallback={<UsersFallback />}>
      <UsersContent />
    </React.Suspense>
  )
}
