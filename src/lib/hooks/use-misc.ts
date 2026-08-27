import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as api from "@/lib/api/misc"
import type { CompanySettings, User } from "@/lib/types"
import { toast } from "sonner"

export const usersKey = ["users"] as const
export const notificationsKey = ["notifications"] as const
export const activityLogsKey = ["activityLogs"] as const
export const settingsKey = ["settings"] as const

export function useUsers() {
  return useQuery({ queryKey: usersKey, queryFn: api.listUsers })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; email: string; role: User["role"]; password: string }) => api.createUser(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey })
      qc.invalidateQueries({ queryKey: activityLogsKey })
      toast.success("User created successfully")
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create user"),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: Partial<Pick<User, "name" | "email" | "role" | "avatarUrl" | "phone">>
    }) => api.updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey })
      qc.invalidateQueries({ queryKey: activityLogsKey })
      toast.success("User updated successfully")
    },
    onError: () => toast.error("Failed to update user"),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKey })
      qc.invalidateQueries({ queryKey: activityLogsKey })
      toast.success("User deleted")
    },
    onError: () => toast.error("Failed to delete user"),
  })
}

export function useNotifications() {
  return useQuery({ queryKey: notificationsKey, queryFn: api.listNotifications, refetchInterval: 30000 })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationsKey }),
  })
}

export function useSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: api.getSettings })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: Partial<CompanySettings>) => api.updateSettings(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKey })
      qc.invalidateQueries({ queryKey: activityLogsKey })
      toast.success("Settings saved")
    },
    onError: () => toast.error("Failed to save settings"),
  })
}
