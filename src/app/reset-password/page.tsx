"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/shared/password-input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Logo } from "@/components/shared/logo"
import { supabase } from "@/lib/supabase/client"
import { authErrorMessage } from "@/lib/supabase/errors"

const schema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type Status = "checking" | "ready" | "invalid"

// Standalone page (outside the (app) route group, no auth guard) that a
// password-reset email's link lands on. Supabase's client auto-exchanges the
// link's token into a temporary "recovery" session on load — we just wait
// for that (PASSWORD_RECOVERY event, or a session already present) before
// showing the new-password form.
export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = React.useState<Status>("checking")

  React.useEffect(() => {
    let resolved = false

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !resolved) {
        resolved = true
        setStatus("ready")
      }
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !resolved) {
        resolved = true
        setStatus("ready")
      }
    })

    // The recovery link's token is processed client-side almost immediately on
    // load — if neither path above has resolved within a few seconds, the
    // link is missing, already used, or expired.
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        setStatus("invalid")
      }
    }, 4000)

    return () => {
      subscription.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  async function onSubmit(values: z.infer<typeof schema>) {
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      toast.error(authErrorMessage(error))
      return
    }
    toast.success("Password updated — please sign in with your new password.")
    await supabase.auth.signOut()
    router.push("/login")
  }

  const passwordError = form.formState.errors.password?.message
  const confirmPasswordError = form.formState.errors.confirmPassword?.message

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-xl font-semibold">MW2000</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reset your password</CardTitle>
            <CardDescription>
              {status === "ready" ? "Choose a new password for your account." : " "}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === "checking" && (
              <p className="text-sm text-muted-foreground">Verifying your reset link&hellip;</p>
            )}
            {status === "invalid" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This reset link is invalid or has expired. Request a new one from the sign-in page.
                </p>
                <Button className="w-full" onClick={() => router.push("/login")}>
                  Back to sign in
                </Button>
              </div>
            )}
            {status === "ready" && (
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid gap-2">
                  <Label>New Password</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!passwordError}
                    {...form.register("password")}
                  />
                  {passwordError && <p className="text-destructive text-sm">{passwordError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Confirm New Password</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!confirmPasswordError}
                    {...form.register("confirmPassword")}
                  />
                  {confirmPasswordError && <p className="text-destructive text-sm">{confirmPasswordError}</p>}
                </div>
                <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Updating..." : "Update password"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
