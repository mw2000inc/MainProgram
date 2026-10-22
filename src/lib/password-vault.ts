import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

// The encrypted copy of a password set from the Users page (public.password_
// vault, 20261124000000), readable only by cashout through the API. AES-256-
// GCM with a key derived from the server's own service-role secret, so the
// table alone never reveals a password. Every call is best-effort: a missing
// table (migration not run yet) or a bad row just means "not known".

const key = () => createHash("sha256").update(`mw2000-password-vault:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`).digest()

function encrypt(password: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":")
}

function decrypt(stored: string): string | null {
  const [version, iv, tag, data] = stored.split(":")
  if (version !== "v1" || !iv || !tag || !data) return null
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"))
    decipher.setAuthTag(Buffer.from(tag, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

export async function rememberPassword(admin: SupabaseClient, userId: string, password: string, setBy: string): Promise<void> {
  await admin
    .from("password_vault")
    .upsert({ user_id: userId, cipher: encrypt(password), set_at: new Date().toISOString(), set_by: setBy })
    .then(
      () => undefined,
      () => undefined
    )
}

export async function recallPassword(admin: SupabaseClient, userId: string): Promise<{ password: string; setAt: string } | null> {
  const res = await admin.from("password_vault").select("cipher, set_at").eq("user_id", userId).maybeSingle()
  if (res.error || !res.data) return null
  const password = decrypt(res.data.cipher as string)
  return password === null ? null : { password, setAt: res.data.set_at as string }
}

export async function forgetPassword(admin: SupabaseClient, userId: string): Promise<void> {
  await admin
    .from("password_vault")
    .delete()
    .eq("user_id", userId)
    .then(
      () => undefined,
      () => undefined
    )
}
