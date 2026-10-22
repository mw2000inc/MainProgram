// The only account(s) that may set another account's password from the Users
// page: cashout (the owner's account) — not other admins. Checked again on
// the server (/api/admin/users/[id]/password); the client only uses it to
// show the "Change password" menu item. Passwords themselves can never be
// read back (Supabase keeps only a one-way hash), so this sets a new one.
export const PASSWORD_MANAGER_USER_IDS = ["de94b8d1-439e-4786-ba30-6eafbd99bd8c"] as const

export function canManagePasswords(userId: string | undefined): boolean {
  return !!userId && (PASSWORD_MANAGER_USER_IDS as readonly string[]).includes(userId)
}

// Supabase's own minimum length for a password.
export const MIN_PASSWORD_LENGTH = 6
