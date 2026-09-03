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
import { useTranslation, usePreAuthLocale } from "@/lib/i18n/i18n-context"
import { supabase } from "@/lib/supabase/client"
import { authErrorMessage } from "@/lib/supabase/errors"

// Schemas are built from a translation function rather than defined once at
// module scope — validation messages need to change with the locale, and
// `t()` only exists once useTranslation() has run inside the component (see
// LoginPage's own useMemo below, which rebuilds these whenever `t` changes,
// i.e. whenever the locale does).
function createSignInSchema(t: (key: string) => string) {
  return z.object({
    email: z.string().email(t("emailInvalid")),
    password: z.string().min(4, t("passwordMinLength4")),
  })
}

// No role field — public self-signup always creates a Technician account
// (the least-privileged role), never Admin. Only an existing admin can
// create/promote an Admin account, via the Users page (which has its own
// role picker and requires an authenticated admin caller server-side, see
// /api/admin/users) or a manual role update in the database — see the
// close_role_escalation migration for why raw_user_meta_data is no longer
// trusted for role at all here.
function createSignUpSchema(t: (key: string) => string) {
  return z
    .object({
      name: z.string().min(2, t("fullNameRequired")),
      email: z.string().email(t("emailInvalid")),
      password: z.string().min(6, t("passwordMinLength6")),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("passwordsDoNotMatch"),
      path: ["confirmPassword"],
    })
}

type Mode = "signin" | "signup"

const REMEMBERED_EMAIL_KEY = "mw2000-remembered-email"

export default function LoginPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const { t } = useTranslation("auth")
  const { locale, setLocale } = usePreAuthLocale()
  const [mode, setMode] = React.useState<Mode>("signin")
  const [resetPending, setResetPending] = React.useState(false)

  const signInSchema = React.useMemo(() => createSignInSchema(t), [t])
  const signUpSchema = React.useMemo(() => createSignUpSchema(t), [t])

  React.useEffect(() => {
    if (!loading && user) router.replace("/")
  }, [loading, user, router])

  // /auth/callback bounces back here with ?oauth_error=1 if the Google code
  // exchange failed (e.g. an expired/reused code) — surface it once, then
  // scrub the URL so refreshing doesn't re-show the toast.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get("oauth_error")) {
      toast.error(t("googleSignInFailed"))
      window.history.replaceState(null, "", window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        signInForm.setError("email", { message: t("confirmEmailFirst") })
      } else {
        signInForm.setError("password", { message: t("incorrectCredentials") })
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
    // The signed-in user is sent back to /auth/callback (not straight to
    // /login) — that route exchanges the one-time code for a session
    // server-side, then redirects to "/", where the app's own auth guard
    // takes over. A first-time Google sign-in creates a new account same as
    // email signup — Google's own identity data never includes a "role" key,
    // so this also falls through to handle_new_user()'s 'technician' default.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) toast.error(authErrorMessage(error))
  }

  async function handleForgotPassword() {
    const email = signInForm.getValues("email").trim()
    if (!email) {
      signInForm.setError("email", { message: t("enterEmailFirst") })
      return
    }
    setResetPending(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setResetPending(false)
    if (error) {
      toast.error(authErrorMessage(error))
      return
    }
    toast.success(t("resetLinkSent"))
  }

  async function onSignUp(values: z.infer<typeof signUpSchema>) {
    // No role here (deliberately) — options.data only ever reaches
    // raw_user_meta_data, which handle_new_user() no longer trusts for role
    // at all (a public signUp() call has no way to set app_metadata, which
    // is what the trigger actually reads role from now — see the
    // close_role_escalation migration). Every self-signup, this or Google's,
    // falls through to that trigger's 'technician' default; only an admin
    // creating a user via the Users page (or a manual database update) can
    // produce an admin account.
    const { error } = await supabase.auth.signUp({
      email: values.email.trim(),
      password: values.password,
      options: { data: { name: values.name.trim() } },
    })
    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        signUpForm.setError("email", { message: t("accountAlreadyExists") })
      } else {
        toast.error(authErrorMessage(error))
      }
      return
    }
    // The account can't actually sign in yet until email confirmation is
    // completed (Auth has "Confirm email" enabled on this project) — say so
    // rather than implying they can use the app immediately.
    toast.success(t("accountCreatedCheckEmail"))
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
        {/* Pre-auth locale toggle — the only way to pick a language before
            signing in, since there's no profile yet to read one from (see
            usePreAuthLocale's own comment). */}
        <div className="mb-4 flex justify-end gap-1 text-xs">
          <button
            type="button"
            onClick={() => setLocale("en")}
            className={locale === "en" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            English
          </button>
          <span className="text-muted-foreground">/</span>
          <button
            type="button"
            onClick={() => setLocale("ko")}
            className={locale === "ko" ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            한국어
          </button>
        </div>

        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="h-12 w-12" />
          <h1 className="text-xl font-semibold">MW2000</h1>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{mode === "signin" ? t("signIn") : t("createAccount")}</CardTitle>
            <CardDescription>{mode === "signin" ? t("signInDescription") : t("signUpDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {mode === "signin" ? (
              <>
              {/* Plain uncontrolled inputs (via register(), not Controller's value/onChange binding) —
                  some browser/extension combinations fight a *controlled* value on login-shaped fields,
                  silently reverting typed text. Letting the DOM own the value sidesteps that entirely. */}
              <form onSubmit={signInForm.handleSubmit(onSignIn)} className="space-y-4">
                <div className="grid gap-2">
                  <Label>{t("email")}</Label>
                  <Input
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    aria-invalid={!!signInEmailError}
                    {...signInForm.register("email")}
                  />
                  {signInEmailError && <p className="text-destructive text-sm">{signInEmailError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>{t("password")}</Label>
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
                    {t("rememberMe")}
                  </label>
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline disabled:opacity-50"
                    disabled={resetPending}
                    onClick={handleForgotPassword}
                  >
                    {resetPending ? t("sending") : t("forgotPassword")}
                  </button>
                </div>
                <Button type="submit" className="w-full" disabled={signInForm.formState.isSubmitting}>
                  {t("signIn")}
                </Button>
              </form>
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t("or")}</span>
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn}>
                <GoogleIcon className="h-4 w-4" />
                {t("signInWithGoogle")}
              </Button>
              </>
            ) : (
              <form onSubmit={signUpForm.handleSubmit(onSignUp)} className="space-y-4">
                <div className="grid gap-2">
                  <Label>{t("fullName")}</Label>
                  <Input
                    placeholder="Juan Dela Cruz"
                    autoComplete="name"
                    aria-invalid={!!signUpNameError}
                    {...signUpForm.register("name")}
                  />
                  {signUpNameError && <p className="text-destructive text-sm">{signUpNameError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>{t("workEmail")}</Label>
                  <Input
                    placeholder="you@yourcompany.com"
                    autoComplete="email"
                    aria-invalid={!!signUpEmailError}
                    {...signUpForm.register("email")}
                  />
                  {signUpEmailError && <p className="text-destructive text-sm">{signUpEmailError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>{t("password")}</Label>
                  <PasswordInput
                    placeholder="••••••••"
                    autoComplete="new-password"
                    aria-invalid={!!signUpPasswordError}
                    {...signUpForm.register("password")}
                  />
                  {signUpPasswordError && <p className="text-destructive text-sm">{signUpPasswordError}</p>}
                </div>
                <div className="grid gap-2">
                  <Label>{t("confirmPassword")}</Label>
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
                  {signUpForm.formState.isSubmitting ? t("creatingAccount") : t("signUp")}
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
                  {t("noAccountSignUp")}
                </button>
              ) : (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setMode("signin")}
                >
                  {t("haveAccountSignIn")}
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
