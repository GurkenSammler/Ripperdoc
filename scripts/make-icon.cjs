// Erzeugt das App-Icon (build/icon.png + build/icon.ico) aus dem "R"-Zeichen der Oberfläche.
// Gerendert mit Electron selbst (Rajdhani Bold), damit es exakt wie in der App aussieht.
//   node_modules\electron\dist\electron.exe scripts\make-icon.cjs
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const out = path.join(root, 'build')
const font = path.join(root, 'src', 'renderer', 'src', 'assets', 'fonts', 'rajdhani_bold.ttf').replace(/\\/g, '/')

const html = `<!doctype html><html><head><style>
@font-face { font-family: R; src: url('file:///${font}'); }
html, body { margin: 0; width: 256px; height: 256px; background: transparent; overflow: hidden; }
.m { position: absolute; left: 10px; top: 10px; width: 236px; height: 236px; background: #E8604F;
     clip-path: polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%); }
.m span { position: absolute; left: 0; right: 0; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center;
     font: 700 210px/1 R; color: #05080D; padding: 18px 22px 0 0; }
.c { position: absolute; right: 10px; bottom: 10px; width: 54px; height: 54px; background: #5EF0FF;
     clip-path: polygon(100% 0, 100% 100%, 0 100%); }
</style></head><body><div class="m"><span>R</span></div><div class="c"></div></body></html>`

/** ICO mit eingebetteten PNGs (geht seit Windows Vista). */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    header.writeUInt8(size >= 256 ? 0 : size, e)
    header.writeUInt8(size >= 256 ? 0 : size, e + 1)
    header.writeUInt8(0, e + 2)
    header.writeUInt8(0, e + 3)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...pngs.map((p) => p.data)])
}

app.whenReady().then(async () => {
  const tmp = path.join(app.getPath('temp'), 'ripperdoc-icon.html')
  fs.writeFileSync(tmp, html)
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  })
  await win.loadFile(tmp)
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
  await new Promise((r) => setTimeout(r, 400))
  const big = await win.webContents.capturePage()
  const base = big.resize({ width: 256, height: 256, quality: 'best' })
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'icon.png'), base.toPNG())
  const pngs = [256, 64, 48, 32, 24, 16].map((size) => ({
    size,
    data: (size === 256 ? base : nativeImage.createFromBuffer(base.toPNG()).resize({ width: size, height: size, quality: 'best' })).toPNG(),
  }))
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs))
  console.log('build/icon.png + build/icon.ico geschrieben')
  fs.unlinkSync(tmp)
  app.quit()
})
