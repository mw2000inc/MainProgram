# MW2000 desktop shell (Tauri)

This is a thin native wrapper around the existing MW2000 web app — it opens a
window that loads `https://mainprogram-neon.vercel.app` directly. It does
**not** bundle a copy of the Next.js app, does **not** talk to Supabase or
Vercel any differently than a normal browser tab would, and does **not**
require any changes to the web app itself to work. Building or running this
has zero effect on the Next.js app, the Vercel deployment, or the Supabase
database/auth — see `tauri.conf.json`'s `build.frontendDist`, which is set to
the production URL instead of a local folder, so there are no local frontend
assets involved at all.

Login, roles/permissions, RLS, the audit trail, everything — all identical to
using the site in a browser, because it *is* the site, just in its own window
instead of a browser tab.

## One-time setup (only needed once per machine)

1. **Rust** — install via [rustup](https://rustup.rs) (or `winget install
   Rustlang.Rustup`). This installs to your user profile, no admin rights
   needed.
2. **Microsoft C++ Build Tools** — Rust on Windows needs the MSVC linker.
   Install via:
   ```powershell
   winget install --id Microsoft.VisualStudio.BuildTools -e --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
   ```
   This one **does** require admin rights and is a multi-GB download.
3. **WebView2 Runtime** — already preinstalled on current Windows 10/11; if
   missing, `winget install Microsoft.EdgeWebView2Runtime`.

Nothing else — no local dev server, no `.env` file needed in `src-tauri/`,
because the app never talks to anything on this machine except the real
production URL.

## Building the installer

From the repo root (not inside `src-tauri/`):

```bash
npm install        # installs @tauri-apps/cli, already in package.json
npm run tauri build
```

This produces an NSIS installer under:

```
src-tauri/target/release/bundle/nsis/MW2000_0.1.0_x64-setup.exe
```

(Tauri names it `{productName}_{version}_{arch}-setup.exe` — there's no
config knob to force an exact filename like `MW2000-Setup.exe`; just rename
the file after the build, e.g.:

```powershell
Rename-Item "src-tauri\target\release\bundle\nsis\MW2000_0.1.0_x64-setup.exe" "MW2000-Setup.exe"
```

## Trying it without building an installer

```bash
npm run tauri dev
```

Opens the same production URL in a Tauri window, no installer needed — good
for a quick "does the window/login/pages work" check.

## Distributing the installer

The `.exe` is a normal file — host it wherever you already host downloads.
Options, roughly in order of effort:

- **Vercel Blob / any object storage**: upload the built `.exe`, link to its
  URL from wherever you want (e.g. a "Download for Windows" button). Doesn't
  require any app code changes.
- **A `/download` page in the Next.js app**: add a page that links out to
  wherever the `.exe` is hosted (object storage, GitHub Release, etc.) — the
  page itself would just be a static link, not something that stores or
  serves the binary from within the Next.js app.
- **GitHub Releases**: attach the `.exe` as a release asset on this repo (if
  the repo/release visibility is appropriate for internal distribution) and
  link to that asset URL.

Whichever you pick, the installer itself has no backend of its own to
host — it's a static file once built.

## What this does *not* do

- No offline mode, no local caching of ERP data — every launch loads the live
  site fresh, same as a browser.
- No auto-update wiring (Tauri supports it, but it wasn't asked for here and
  adds an update-server dependency this task didn't need).
- No native OS integrations (tray icon, notifications, file system access,
  etc.) beyond just being a window — nothing in the web app calls any Tauri
  API, so the web app runs completely unaware it's inside Tauri at all.
