// electron-builder afterPack: Electrons Demo-App (default_app.asar) kommt über electronDist mit,
// gehört aber nicht ins Paket. Läuft vor dem Bau von Installer und Zip.
const fs = require('node:fs')
const path = require('node:path')

exports.default = async function afterPack(context) {
  const demo = path.join(context.appOutDir, 'resources', 'default_app.asar')
  if (fs.existsSync(demo)) fs.rmSync(demo)
}
