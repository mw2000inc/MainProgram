"use client"

import * as React from "react"
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
import { useAuth } from "@/lib/auth/auth-context"
import type { User } from "@/lib/types"

export default function UsersPage() {
  const { user: actor } = useAuth()
  const { data: users = [], isPending } = useUsers()
  const deleteUser = useDeleteUser(actor?.id ?? "")

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<User | undefined>(undefined)
  const [deleting, setDeleting] = React.useState<User | undefined>(undefined)

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
              <UserCog className="h-6 w-6 text-primary" /> Users
            </h1>
            <p className="text-sm text-muted-foreground">Manage Admin and Technician accounts and permissions.</p>
          </div>
          <Button
            onClick={() => {
              setEditing(undefined)
              setFormOpen(true)
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            <DataTable
              columns={columns}
              data={users}
              searchPlaceholder="Search by name or email..."
              emptyMessage="No users found."
            />
          </CardContent>
        </Card>

        <UserFormDialog open={formOpen} onOpenChange={setFormOpen} user={editing} />

        <ConfirmDialog
          open={!!deleting}
          onOpenChange={(o) => !o && setDeleting(undefined)}
          title="Delete user?"
          description={`This will permanently remove ${deleting?.name ?? "this user"}'s account.`}
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
