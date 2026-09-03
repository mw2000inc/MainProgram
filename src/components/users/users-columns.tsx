"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { StatusBadge } from "@/components/shared/status-badge"
import { ColumnHeader } from "@/components/shared/column-header"
import { useTranslation } from "@/lib/i18n/i18n-context"
import { formatDate, initials } from "@/lib/utils"
import type { User } from "@/lib/types"

function NameCell({ user, currentUserId }: { user: User; currentUserId?: string }) {
  const { t } = useTranslation("users")
  return (
    <div className="flex items-center gap-2.5">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">{initials(user.name)}</AvatarFallback>
      </Avatar>
      <div>
        <div className="font-medium">{user.name}</div>
        {user.id === currentUserId && <div className="text-xs text-muted-foreground">{t("you")}</div>}
      </div>
    </div>
  )
}

function RoleCell({ role }: { role: User["role"] }) {
  const { t } = useTranslation("common")
  return role === "admin" ? (
    <StatusBadge tone="secondary" label={t("admin")} />
  ) : (
    <StatusBadge tone="neutral" label={t("technician")} />
  )
}

function RowActionsCell({
  user,
  currentUserId,
  onEdit,
  onDelete,
}: {
  user: User
  currentUserId?: string
  onEdit: (user: User) => void
  onDelete: (user: User) => void
}) {
  const { t } = useTranslation("common")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onEdit(user)}>
          <Pencil className="h-4 w-4" /> {t("edit")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={user.id === currentUserId} onClick={() => onDelete(user)}>
          <Trash2 className="h-4 w-4" /> {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function getUsersColumns({
  currentUserId,
  onEdit,
  onDelete,
}: {
  currentUserId?: string
  onEdit: (user: User) => void
  onDelete: (user: User) => void
}): ColumnDef<User, unknown>[] {
  return [
    {
      accessorKey: "name",
      header: () => <ColumnHeader tKey="name" ns="fields" />,
      cell: ({ row }) => <NameCell user={row.original} currentUserId={currentUserId} />,
    },
    {
      accessorKey: "email",
      header: () => <ColumnHeader tKey="email" ns="fields" />,
    },
    {
      accessorKey: "role",
      header: () => <ColumnHeader tKey="role" ns="fields" />,
      cell: ({ row }) => <RoleCell role={row.original.role} />,
    },
    {
      accessorKey: "createdAt",
      header: () => <ColumnHeader tKey="created" ns="users" />,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <RowActionsCell user={row.original} currentUserId={currentUserId} onEdit={onEdit} onDelete={onDelete} />
      ),
    },
  ]
}
