// electron-builder "beforeBuild" hook. The desktop app (desktop/app) has no
// npm dependencies — it only opens the MW2000 web app in a window — so there is
// nothing to install, rebuild or copy. Returning false tells electron-builder
// node_modules are handled here, which also skips its dependency scan (that
// scan shells out to PowerShell, which this machine's security software
// blocks for Node processes).
module.exports = async function beforeBuild() {
  return false
}
