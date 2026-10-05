// MW2000 desktop app — an Electron window around the MW2000 web app.
//
// It loads the live site (the same deploy everyone uses), not a copy of the
// Next.js server: the server needs the Supabase service-role key and other
// secrets, which must never be shipped inside an installer. The desktop app
// therefore always runs the latest deploy and holds no secrets.
//
//   npm run desktop:dev    → Next dev server + this window on http://localhost:3000
//   npm run desktop:start  → this window on the live site
//   npm run desktop:build  → Windows installer + portable .exe in dist/
//
// ELECTRON_START_URL overrides the address (e.g. a preview deploy).
const { app, BrowserWindow, Menu, shell } = require("electron")
const path = require("node:path")

const PRODUCTION_URL = "https://mainprogram-neon.vercel.app"
const START_URL =
  process.env.ELECTRON_START_URL || (app.isPackaged || process.argv.includes("--live") ? PRODUCTION_URL : "http://localhost:3000")
const APP_ORIGIN = new URL(START_URL).origin

// Sign-in flows that must stay inside the window (Supabase auth and Google's
// OAuth consent screen); every other external link opens in the browser.
const IN_APP_HOSTS = [/\.supabase\.co$/, /^accounts\.google\.com$/, /^accounts\.youtube\.com$/]
const staysInApp = (url) => {
  try {
    const u = new URL(url)
    return u.origin === APP_ORIGIN || IN_APP_HOSTS.some((re) => re.test(u.hostname))
  } catch {
    return false
  }
}

const offlinePage = (url, reason) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><title>MW2000</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 40px;text-align:center;max-width:420px}
h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#64748b;margin:0 0 20px}
button{background:#0077b6;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer}</style></head>
<body><div class="card"><h1>Can't reach MW2000</h1><p>Check your internet connection, then try again.<br><small>${reason}</small></p>
<button onclick="location.href='${url}'">Try again</button></div></body></html>`)}`

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "MW2000",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#f8fafc",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })

  // Google refuses sign-in from browsers that announce themselves as
  // Electron, so present the plain Chrome user agent.
  mainWindow.webContents.setUserAgent(mainWindow.webContents.getUserAgent().replace(/\s*Electron\/\S+/, "").replace(/\s*mw2000-desktop\/\S+/, ""))

  mainWindow.once("ready-to-show", () => mainWindow.show())

  // New windows (target=_blank, window.open): app pages and sign-in stay in
  // the app; anything else opens in the default browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (staysInApp(url)) return { action: "allow" }
    shell.openExternal(url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("data:") || staysInApp(url)) return
    event.preventDefault()
    shell.openExternal(url)
  })

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // -3 = aborted (a normal redirect), not a real failure.
    if (!isMainFrame || code === -3) return
    mainWindow.loadURL(offlinePage(url || START_URL, `${description} (${code})`))
  })

  mainWindow.loadURL(START_URL)
}

// One window: launching the app again focuses the existing one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    // Keep the standard Edit/View shortcuts (copy, paste, zoom, reload) with
    // the menu bar hidden.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
            ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
          ],
        },
      ])
    )
    createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
