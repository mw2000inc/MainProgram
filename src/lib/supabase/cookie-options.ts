// Supabase's session cookies are SameSite=Lax by default. A mobile preview in
// VS Code (and similar device-frame tools) shows localhost inside a frame of
// another site, where the browser refuses to save Lax cookies — the sign-in
// succeeds but the session is thrown away, so you stay on the login page.
// In development only, the cookies are SameSite=None; Secure, which a framed
// localhost may save (localhost counts as secure, even over http). The live
// site keeps Supabase's defaults (Lax), which is the safer setting there.
export const supabaseCookieOptions = process.env.NODE_ENV === "development" ? { sameSite: "none" as const, secure: true } : undefined
