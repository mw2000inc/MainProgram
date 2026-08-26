"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Logo } from "@/components/shared/logo"
import { GoogleIcon } from "@/components/shared/google-icon"
import { PasswordInput } from "@/components/shared/password-input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/lib/auth/auth-context"
import { supabase } from "@/lib/supabase/client"

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(4, "Password must be at least 4 characters"),
})

// No role field — public self-signup always creates an Admin account.
// Technician accounts are created exclusively by an admin via the Users
// page, which has its own role picker and requires an authenticated admin
// caller server-side (see /api/admin/users).
const signUpSchema = z
  .object({
    name: z.string().min(2, "Full name is required"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })

type Mode = "signin" | "signup"

const REMEMBERED_EMAIL_KEY = "mw2000-remembered-email"

export default function LoginPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [mode, setMode] = React.useState<Mode>("signin")
  const [resetPending, setResetPending] = React.useState(false)

  React.useEffect(() => {
    if (!loading && user) router.replace("/")
  }, [loading, user, router])

  // /auth/callback bounces back here with ?oauth_error=1 if the Google code
  // exchange failed (e.g. an expired/reused code) — surface it once, then
  // scrub the URL so refreshing doesn't re-show the toast.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("oauth_error")) {
      toast.error("Google sign-in didn't complete — please try again.")
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

  const signInForm = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  })
  // Always false on the initial render (server and client alike) to avoid a
  // hydration mismatch — reading localStorage during the state initializer
  // would make the client's first render disagree with the server's, since
  // the server has no localStorage. Synced from the real stored value below,
  // after mount.
  const [rememberMe, setRememberMe] = React.useState(false)

  // Pre-fill the remembered email (never the password — that's the browser's own
  // password manager's job, not something we store ourselves) on first load.
  React.useEffect(() => {
    const remembered = window.localStorage.getItem(REMEMBERED_EMAIL_KEY)
    if (remembered) {
      signInForm.setValue("email", remembered)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRememberMe(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signUpForm = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  })

  async function onSignIn(values: z.infer<typeof signInSchema>) {
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email.trim(),
      password: values.password,
    })
    if (error) {
      // Supabase returns this distinct error (not "invalid credentials") when
      // the password is actually correct but the account's email hasn't been
      // confirmed yet — surface that accurately instead of telling someone
      // with a correct password that it's wrong.
      if (error.code === "email_not_confirmed") {
        signInForm.setError("email", {
          message: "Please confirm your email first — check your inbox for the confirmation link from signup.",
        })
      } else {
        signInForm.setError("password", { message: "Incorrect email or password." })
      }
      return
    }
    if (rememberMe) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, values.email.trim())
    } else {
      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
    }
    // AuthProvider's onAuthStateChange listener picks up the new session, which
    // updates `user` above and triggers the redirect effect.
  }

  async function handleGoogleSignIn() {
    // Redirects the browser to Google's own account chooser/consent screen.
    // Google sends the admin back to /auth/callback (not straight to /login)
    // — that route exchanges the one-time code for a session server-side,
    // then redirects to "/", where the app's own auth guard takes over. A
    // first-time Google sign-in creates a new account same as email signup
    // — Google's own identity data never includes a "role" key, so this
    // also falls through to handle_new_user()'s 'admin' default.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) toast.error(error.message)
  }

  async function handleForgotPassword() {
    const email = signInForm.getValues("email").trim()
    if (!email) {
      signInForm.setError("email", { message: "Enter your email first, then click \"Forgot password?\"" })
      return
    }
    setResetPending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetPending(false)
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success("Password reset link sent — check your email.")
  }

  async function onSignUp(values: z.infer<typeof signUpSchema>) {
    // No role here (deliberately) — options.data only ever reaches
    // raw_user_meta_data, which handle_new_user() no longer trusts for
    // role at all (a public signUp() call has no way to set app_metadata,
    // which is what the trigger actually reads role from now — see the
    // technician_role migration). Every self-signup, this or Google's,
    // falls through to that trigger's 'admin' default; only an admin
    // creating a user via the Users page can produce a technician account.
    const { error } = await supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: { data: { name: values.name.trim() } },
    })
    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        signUpForm.setError("email", { message: "An account with this email already exists." })
      } else {
        toast.error(error.message)
      }
      return
    }
    // The account can't actually sign in yet until email confirmation is
    // completed (Auth has "Confirm email" enabled on this project) — say so
    // rather than implying they can use the app immediately.
    toast.success("Account created! Check your email to confirm your address before signing in.")
  }

  const signInEmailError = signInForm.formState.errors.email?.message
  const signInPasswordError = signInForm.formState.errors.password?.message

  const signUpNameError = signUpForm.formState.errors.name?.message
  const signUpEmailError = signUpForm.formState.errors.email?.message
  const signUpPasswordError = signUpForm.formState.errors.password?.message
  const signUpConfirmPasswordError = signUpForm.formState.errors.confirmPassword?.message

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-xl font-semibold">MW2000</h1>
          <p className="text-sm text-muted-foreground">
            Customer, Sales &amp; Inventory Management for Water Purification
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{mode === "signin" ? "Sign in" : "Create an account"}</CardTitle>
            <CardDescription>
              {mode === "signin"
                ? "Enter your work email to continue."
                : "Create your Admin account — Technician accounts are set up by an admin from the Users page."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {mode === "signin" ? (
              <>
              {/* Plain uncontrolled inputs (via register(), not Controller's value/onChange binding) —
                  some browser/extension combinations fight a *controlled* value on login-shaped fields,
                  silently reverting typed text. Letting the DOM own the value sidesteps that entirely. */}
              <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4">
                <div className="grid gap-2">
                  <Label>Email</Label>
                  <Input
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    aria-invalid={!!signInEmailError}
                    {...signInForm.register("email")}
                  />
                  {signInEmailError && <p className="text-destructive text-sm">{signInEmailError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Password</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="current-password"
                    aria-invalid={!!signInPasswordError}
                    {...signInForm.register("password")}
                  />
                  {signInPasswordError && <p className="text-destructive text-sm">{signInPasswordError}</p>}
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={rememberMe} onCheckedChange={(v) => setRememberMe(v === true)} />
                    Remember me
                  </label>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                    disabled={resetPending}
                    onClick={handleForgotPassword}
                  >
                    {resetPending ? "Sending..." : "Forgot password?"}
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={signInForm.formState.isSubmitting}>
                  Sign in
                </Button>
              </form>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or</span>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn}>
                <GoogleIcon className="h-4 w-4" />
                Sign in with Google
              </Button>
              </>
            ) : (
              <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4">
                <div className="grid gap-2">
                  <Label>Full Name</Label>
                  <Input
                    placeholder="Juan Dela Cruz"
                    autoComplete="name"
                    aria-invalid={!!signUpNameError}
                    {...signUpForm.register("name")}
                  />
                  {signUpNameError && <p className="text-destructive text-sm">{signUpNameError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Work Email</Label>
                  <Input
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    aria-invalid={!!signUpEmailError}
                    {...signUpForm.register("email")}
                  />
                  {signUpEmailError && <p className="text-destructive text-sm">{signUpEmailError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Password</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!signUpPasswordError}
                    {...signUpForm.register("password")}
                  />
                  {signUpPasswordError && <p className="text-destructive text-sm">{signUpPasswordError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>Confirm Password</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!signUpConfirmPasswordError}
                    {...signUpForm.register("confirmPassword")}
                  />
                  {signUpConfirmPasswordError && (
                    <p className="text-destructive text-sm">{signUpConfirmPasswordError}</p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={signUpForm.formState.isSubmitting}>
                  {signUpForm.formState.isSubmitting ? "Creating account..." : "Sign up"}
                </Button>
              </form>
            )}

            <div className="text-center text-sm">
              {mode === "signin" ? (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMode("signup")}
                >
                  Don&apos;t have an account? Sign up
                </button>
              ) : (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMode("signin")}
                >
                  Already have an account? Sign in
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
