"use client"

import * as React from "react"
import { Check, Copy, Eye, EyeOff, KeyRound, Shuffle } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MIN_PASSWORD_LENGTH } from "@/lib/password-manager"
import { formatDateTime } from "@/lib/utils"
import type { User } from "@/lib/types"

// Cashout's "Change password" for an account (Users page ⋯ menu). First the
// CURRENT password, when it was set through the app (Add User / this dialog —
// its encrypted copy, see password-vault.ts); one set before that, or changed
// by the person themselves, can't be shown. Then a new one, typed in plain
// view (or generated), set on the server and kept the same way.
export function SetPasswordDialog({ user, onOpenChange }: { user: User | undefined; onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [done, setDone] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [forId, setForId] = React.useState<string | undefined>(undefined)
  // The current password: undefined = loading, null = not known.
  const [current, setCurrent] = React.useState<{ password: string; setAt: string } | null | undefined>(undefined)
  const [showCurrent, setShowCurrent] = React.useState(true)
  if (user?.id !== forId) {
    setForId(user?.id)
    setPassword("")
    setDone(null)
    setCopied(false)
    setCurrent(undefined)
    setShowCurrent(true)
  }
  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    fetch(`/api/admin/users/${encodeURIComponent(user.id)}/password`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { password: string | null; setAt: string | null } | null) => {
        if (!cancelled) setCurrent(body?.password ? { password: body.password, setAt: body.setAt ?? "" } : null)
      })
      .catch(() => !cancelled && setCurrent(null))
    return () => {
      cancelled = true
    }
  }, [user])

  const tooShort = password.length < MIN_PASSWORD_LENGTH
  const spaced = password !== password.trim()

  function generate() {
    // Easy to read aloud and type on a phone: lowercase letters and digits,
    // no look-alikes (l/1, o/0).
    const chars = "abcdefghijkmnpqrstuvwxyz23456789"
    const bytes = new Uint32Array(10)
    crypto.getRandomValues(bytes)
    setPassword(Array.from(bytes, (b) => chars[b % chars.length]).join(""))
  }

  async function save() {
    if (!user || tooShort || spaced) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || "Couldn't change the password")
      setDone(password)
      toast.success(`Password changed for ${user.name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change the password")
    } finally {
      setSaving(false)
    }
  }

  async function copy() {
    if (!done) return
    try {
      await navigator.clipboard.writeText(done)
      setCopied(true)
    } catch {
      toast.error("Couldn't copy — select the password and copy it by hand")
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Change password
          </DialogTitle>
          <DialogDescription>
            {user ? `${user.name} · ${user.email}` : ""}
          </DialogDescription>
        </DialogHeader>
        {!done && (
          <div className="space-y-1.5 rounded-md border bg-muted/40 p-3" data-testid="set-password-current">
            <p className="text-xs font-medium text-muted-foreground">Current password</p>
            {current === undefined ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : current ? (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex-1 select-all rounded-md border bg-background px-3 py-1.5 font-mono text-sm" data-testid="set-password-current-value">
                    {showCurrent ? current.password : "•".repeat(Math.max(current.password.length, 6))}
                  </code>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowCurrent((v) => !v)} title={showCurrent ? "Hide" : "Show"}>
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                {current.setAt && <p className="text-xs text-muted-foreground">Set {formatDateTime(current.setAt)}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not known — it was set before passwords were kept here, or the person changed it themselves. Set a new one below and it will show here next time.
              </p>
            )}
          </div>
        )}
        {done ? (
          <div className="space-y-2" data-testid="set-password-done">
            <p className="text-sm">The new password is set. Send it to {user?.name} now — it won&apos;t be shown again:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">{done}</code>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <div className="flex items-center gap-2">
              <Input
                id="new-password"
                type="text"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono"
                data-testid="set-password-input"
              />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={generate} title="Make a random password">
                <Shuffle className="h-3.5 w-3.5" /> Generate
              </Button>
            </div>
            <p className={password && (tooShort || spaced) ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {spaced ? "No spaces at the start or end." : `At least ${MIN_PASSWORD_LENGTH} characters. Capital letters count — "Abc" isn't "abc".`}
            </p>
          </div>
        )}
        <DialogFooter>
          {done ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" onClick={save} disabled={saving || tooShort || spaced} data-testid="set-password-save">
                {saving ? "Saving…" : "Set password"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
