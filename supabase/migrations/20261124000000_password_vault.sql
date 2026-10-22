-- Cashout's password vault: an ENCRYPTED copy of each password set from the
-- Users page (Change password, Add User), so cashout can see an account's
-- current password before changing it.
--
-- Passwords set before this existed can't be recovered — Supabase Auth only
-- keeps a one-way hash — so an account shows its password here only once it
-- has been set through the app. The copy is encrypted by the server
-- (AES-256-GCM, see src/lib/password-vault.ts) before it's stored; this table
-- never holds a readable password. When someone changes their own password
-- (Forgot password), their copy is deleted, so a stale one is never shown.
--
-- No RLS policies: only the server (service role) can read or write it, and
-- the API only answers cashout (src/lib/password-manager.ts).
--
-- Running this changes no existing rows: it adds one empty table.

create table if not exists public.password_vault (
  user_id uuid primary key references auth.users (id) on delete cascade,
  cipher text not null,
  set_at timestamptz not null default now(),
  set_by uuid references auth.users (id) on delete set null
);

alter table public.password_vault enable row level security;
revoke all on public.password_vault from anon, authenticated;
