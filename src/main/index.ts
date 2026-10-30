import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from 'electron'
import { CORE_METHODS, type CoreApi, type CoreEvent } from '@shared/api'
import { BRAND } from '@shared/brand'
import { resolveLang, setLang, t } from '@shared/i18n'
import { Core } from './core'
import { modUrl, NEXUS_GAME } from './nexus/nxm'
import type { ProtocolControl } from './nexus/service'
import { SHARD_EXT } from './plans'
import { UNINSTALL_ABORT, UNINSTALL_CONTINUE, uninstallCleanup, type UninstallChoice } from './uninstall'
import { safeJoin } from './util/paths'

// Test-Hooks (wie bei NC-OS): --shot=<datei.png> macht nach --shot-delay ms ein Bild des Fensters und
// beendet die App; --screen=<name> öffnet direkt einen Screen, --noboot überspringt die Boot-Sequenz,
// --userdata=<ordner> nimmt andere Einstellungen (z. B. mit einem Test-Spielordner statt dem echten Spiel).
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (process.argv.includes(`--${name}`) ? '' : undefined)

const userDataOverride = arg('userdata')
if (userDataOverride) app.setPath('userData', path.resolve(userDataOverride))

// Einmalige Einrichtung: RIPPERDOC_NEXUS_KEY=<key> beim Start → wird geprüft und verschlüsselt gespeichert.
// Sofort aus der Umgebung löschen, damit das Spiel (Kindprozess) den Key nie erbt.
const envNexusKey = process.env.RIPPERDOC_NEXUS_KEY
delete process.env.RIPPERDOC_NEXUS_KEY

// nxm:// zeigt auf diese App. Ohne Paket startet electron.exe mit dem Projektordner als Argument.
const protoArgs = app.isPackaged ? [] : [path.resolve(app.getAppPath())]
const protocol: ProtocolControl = {
  status: () => {
    if (app.isDefaultProtocolClient('nxm', process.execPath, protoArgs)) return { state: 'ours', other: null }
    const other = app.getApplicationNameForProtocol('nxm://')
    return other ? { state: 'other', other } : { state: 'none', other: null }
  },
  set: (on) =>
    on ? app.setAsDefaultProtocolClient('nxm', process.execPath, protoArgs) : app.removeAsDefaultProtocolClient('nxm', process.execPath, protoArgs),
}

const nxmIn = (argv: string[]): string | undefined => argv.find((a) => a.toLowerCase().startsWith('nxm://'))
// Doppelklick auf eine .rdshard-Datei (Dateizuordnung aus dem Installer)
const shardIn = (argv: string[]): string | undefined => argv.slice(1).find((a) => /\.rdshard$/i.test(a) && !a.startsWith('--'))

// --nexus-offline: Nexus-Störung nachstellen (jede Anfrage an api.nexusmods.com scheitert), um die Anzeige zu prüfen
const nexusFetch: typeof fetch | undefined =
  arg('nexus-offline') !== undefined
    ? (input, init) =>
        String(input instanceof Request ? input.url : input).startsWith('https://api.nexusmods.com')
          ? Promise.reject(new TypeError('fetch failed', { cause: { code: 'SIMULIERT' } }))
          : fetch(input, init)
    : undefined

let win: BrowserWindow | null = null

const emit = (event: CoreEvent, payload: unknown): void => {
  win?.webContents.send(`rd:event:${event}`, payload)
}

const core = new Core({
  userData: app.getPath('userData'),
  openUrl: (url) => shell.openExternal(url),
  emit,
  appVersion: app.getVersion(),
  crypto: {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  },
  protocol,
  fetchImpl: nexusFetch,
  systemLocales: () => app.getPreferredSystemLanguages(),
})

/** Neuer Datenordner: einmal sauber neu starten (die Oberfläche zeigt vorher kurz die Meldung). */
function relaunchIfNeeded<T extends { restart: boolean }>(r: T): T {
  if (r.restart) {
    // Ein nxm-Link vom ersten Start darf nicht noch einmal laden
    const args = process.argv.slice(1).filter((a) => !a.toLowerCase().startsWith('nxm://'))
    setTimeout(() => {
      app.relaunch({ args })
      app.quit() // über before-quit, damit laufende Schritte erst fertig werden
    }, 1800)
  }
  return r
}

async function loadSounds(): Promise<Record<string, Uint8Array>> {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const out: Record<string, Uint8Array> = {}
  const from: Record<string, number> = {}
  // default = errechnete Ersatz-Töne, game = Original-UI-Sounds aus Cyberpunk 2077 (werden mit ausgeliefert),
  // custom = private im Projekt (nie im Paket), %APPDATA%\RIPPERDOC\sounds = eigene, auch in der installierten Version
  const dirs = [
    path.join(base, 'sounds', 'default'),
    path.join(base, 'sounds', 'game'),
    path.join(base, 'sounds', 'custom'),
    path.join(app.getPath('userData'), 'sounds'),
  ]
  for (const [i, dir] of dirs.entries()) {
    let names: string[] = []
    try {
      names = (await fs.readdir(dir)).filter((n) => /^sfx_[a-z_]+\.wav$/i.test(n))
    } catch {
      continue
    }
    // Spätere Ordner ersetzen gleichnamige Dateien
    for (const n of names) {
      const name = n.replace(/^sfx_|\.wav$/gi, '').toLowerCase()
      out[name] = new Uint8Array(await fs.readFile(path.join(dir, n)))
      from[name] = i
    }
  }
  // Nur der errechnete Fehler-Ton zwischen Originalen klänge fremd: dann lieber "menu_close" (macht sfx.ts)
  if (from.error === 0 && (from.menu_close ?? 0) > 0) delete out.error
  return out
}

const handlers: CoreApi = {
  appInfo: async () => core.appInfo(app.getVersion(), process.versions.electron),
  getSettings: async () => core.settings.settings,
  setSettings: async (patch) => {
    const next = await core.settings.patch(patch)
    if (patch.theme && win) win.setTitleBarOverlay?.(overlayFor(next.theme))
    if (patch.language) await core.applyLanguage()
    return next
  },
  sounds: loadSounds,
  gameInfo: async () => core.game,
  refreshGame: () => core.refreshGame(),
  pickGameRoot: async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: t('main.app.pickGameRoot'),
      defaultPath: core.game.found ? core.game.root : undefined,
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    return relaunchIfNeeded(await core.setGameRoot(res.filePaths[0]))
  },
  autoGameRoot: async () => relaunchIfNeeded(await core.setGameRoot(null)),
  gameState: async () => core.watcher.state,
  inventory: () => core.inventory(),
  prepare: (paths) => core.prepare(paths),
  chooseVariant: (t, v) => core.chooseVariant(t, v),
  cancelImport: (t) => core.cancelImport(t),
  commitImport: (d) => core.commitImport(d),
  setEnabled: (id, on) => core.setEnabled(id, on),
  move: (id, i) => core.move(id, i),
  removeMod: (id) => core.removeMod(id),
  renameMod: (id, n) => core.renameMod(id, n),
  purge: () => core.purge(),
  redeploy: () => core.redeploy(),
  verify: () => core.verify(),
  journal: (limit) => core.journal.tail(limit),
  launch: () => core.launch(),
  openFolder: async (which, id) => {
    // Nur Ordner bekannter Mods (shell.openPath würde auch eine Datei unter mods/ ausführen)
    if (which === 'mod' && !core.mods.mods.has(id ?? '')) return
    const target =
      which === 'game'
        ? core.game.root
        : which === 'data'
          ? core.dataRoot
          : which === 'downloads'
            ? core.mods.downloadsDir
            : safeJoin(path.join(core.dataRoot, 'mods'), id ?? '')
    if (which === 'downloads') await fs.mkdir(target, { recursive: true })
    if (target) await shell.openPath(target)
  },
  pickFiles: async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: t('main.app.pickArchives'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: t('main.app.filterArchives'), extensions: ['zip', '7z', 'rar', 'archive'] },
        { name: t('main.app.filterAll'), extensions: ['*'] },
      ],
    })
    return res.canceled ? [] : res.filePaths
  },
  pendingImports: async () => core.pendingImports(),
  nexusStatus: async () => core.nexusStatus(),
  nexusSetKey: (key) => core.nexus.setKey(key),
  nexusClearKey: () => core.nexus.clearKey(),
  nexusSetNxm: async (on) => core.nexus.setNxm(on),
  nexusReconnect: () => core.nexus.reconnect(),
  nexusHealth: async () => {
    await core.nexus.refreshHealth()
    return core.nexusStatus()
  },
  downloads: async () => core.nexus.queue.items,
  cancelDownload: async (id) => core.nexus.queue.cancel(id),
  retryDownload: async (id) => core.nexus.queue.retry(id),
  clearDownloads: async () => core.nexus.queue.clearFinished(),
  checkUpdates: () => core.checkUpdates(),
  downloadUpdate: (id) => core.downloadUpdate(id),
  openNexus: async (id) => {
    await shell.openExternal(id ? `${modUrl(Number(id))}?tab=files` : `https://www.nexusmods.com/${NEXUS_GAME}/mods/`)
  },
  setEnabledMany: (ids, on) => core.setEnabledMany(ids, on),
  removeMany: (ids) => core.removeMany(ids),
  requirements: (id, refresh) => core.requirements(Number(id), !!refresh),
  fetchRequirements: (list, parent) => core.fetchRequirements(list, parent),
  loadCollection: (input) => core.loadCollection(input),
  readShard: (text) => core.readShard(text),
  readShardFile: (file) => core.readShardFile(file),
  openShardFile: async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: t('main.app.openShard'),
      properties: ['openFile'],
      filters: [
        { name: 'Shard', extensions: [SHARD_EXT.slice(1), 'json', 'txt'] },
        { name: t('main.app.filterAll'), extensions: ['*'] },
      ],
    })
    return res.canceled || !res.filePaths[0] ? null : core.readShardFile(res.filePaths[0])
  },
  plan: async (id) => core.planView(id),
  closePlan: async (id) => core.closePlan(id),
  pendingPlans: async () => core.pendingPlans(),
  planDownload: (id, keys, force) => core.planDownload(id, keys, !!force),
  planApplyOrder: (id) => core.planApplyOrder(id),
  shareExport: async (o) => core.shareExport(o),
  shareSave: async (o) => {
    const name = (o.title.trim() || 'ripperdoc').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60)
    const res = await dialog.showSaveDialog(win!, {
      title: t('main.app.saveShard'),
      defaultPath: path.join(app.getPath('documents'), `${name}${SHARD_EXT}`),
      filters: [{ name: 'Shard', extensions: [SHARD_EXT.slice(1)] }],
    })
    if (res.canceled || !res.filePath) return null
    await fs.writeFile(res.filePath, core.shareFile(o), 'utf8')
    return res.filePath
  },
  copyText: async (text) => clipboard.writeText(String(text)),
  // Nur Links ins Web (Nexus, Statusseite), nie Dateien oder andere Protokolle
  openUrl: async (url) => {
    if (/^https:\/\/[^\s]+$/i.test(url)) await shell.openExternal(url)
  },
  downloadsUsage: () => core.downloadsUsage(),
  nexusEndorsed: (refresh) => core.nexus.endorsedMods(!!refresh),
  nexusEndorse: (id, version, on) => core.nexus.endorse(Number(id), String(version), !!on),
  cleanDownloads: () => core.cleanDownloads(),
}

for (const name of CORE_METHODS) {
  ipcMain.handle(`rd:${name}`, async (_e, ...args: unknown[]) => {
    const fn = handlers[name] as (...a: unknown[]) => Promise<unknown>
    return fn(...args)
  })
}

const OVERLAY: Record<string, [string, string]> = {
  RED: ['#05080D', '#E8604F'],
  AMBER: ['#07070A', '#FCEE0A'],
  ACID: ['#04090A', '#3DFF9A'],
  VIOLET: ['#07050D', '#C77DFF'],
  ICE: ['#04080C', '#5EF0FF'],
}
const overlayFor = (theme: string) => {
  const [color, symbolColor] = OVERLAY[theme] ?? OVERLAY.RED
  return { color, symbolColor, height: 34 }
}

async function createWindow(): Promise<void> {
  const theme = core.settings.settings.theme
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: BRAND.name,
    icon: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build', 'icon.ico'),
    backgroundColor: overlayFor(theme).color,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(theme),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Datei-Drops sollen nie die Seite ersetzen
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  const query: Record<string, string> = {}
  const screen = arg('screen')
  if (screen) query.screen = screen
  if (arg('noboot') !== undefined) query.noboot = '1'
  const importPath = arg('import')
  if (importPath) query.import = importPath

  const shot = arg('shot')
  if (shot) {
    win.webContents.once('did-finish-load', () => {
      const delay = Number(arg('shot-delay') ?? 4000)
      setTimeout(async () => {
        const img = await win!.webContents.capturePage()
        await fs.writeFile(shot, img.toPNG())
        app.quit()
      }, delay)
    })
  }

  win.once('ready-to-show', () => (shot ? win?.showInactive() : win?.show()))
  if (process.env.ELECTRON_RENDERER_URL) {
    const qs = new URLSearchParams(query).toString()
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${qs ? `?${qs}` : ''}`)
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }
}

// --uninstall: vom Deinstaller aufgerufen, ohne Fenster. Exit-Code 0 = weiter deinstallieren, 2 = abbrechen.
// --answer=purge|keep|cancel beantwortet die Frage ohne Dialog (Test-Hook).
async function runUninstall(): Promise<number> {
  setLang(resolveLang('auto', app.getPreferredSystemLanguages()))
  if (!app.requestSingleInstanceLock()) {
    dialog.showMessageBoxSync({ type: 'warning', title: t('main.uninstall.title'), message: t('main.uninstall.running') })
    return UNINSTALL_ABORT
  }
  try {
    await core.init()
  } catch (err) {
    // Kaputte Einstellungen dürfen das Deinstallieren nicht verhindern
    console.error('uninstall: init failed', err)
    return UNINSTALL_CONTINUE
  }
  const forced = arg('answer') as UninstallChoice | undefined
  const code = await uninstallCleanup(core, {
    ask: async (n) => {
      if (forced) return forced
      const buttons = [t('main.uninstall.purge'), t('main.uninstall.keep'), t('main.uninstall.cancel')]
      const { response } = await dialog.showMessageBox({
        type: 'question',
        title: t('main.uninstall.title'),
        message: t('main.uninstall.message', n),
        detail: t('main.uninstall.detail'),
        buttons,
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      return (['purge', 'keep', 'cancel'] as const)[response]
    },
    failed: async (message) => {
      if (forced) return forced !== 'cancel'
      const { response } = await dialog.showMessageBox({
        type: 'error',
        title: t('main.uninstall.title'),
        message: t('main.uninstall.failed'),
        detail: t('main.uninstall.failedDetail', message),
        buttons: [t('main.uninstall.anyway'), t('main.uninstall.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      return response === 0
    },
  })
  // nxm:// zeigt sonst auf eine gelöschte exe
  if (code === UNINSTALL_CONTINUE && protocol.status().state === 'ours') protocol.set(false)
  core.watcher.dispose()
  core.nexus?.dispose()
  return code
}

if (arg('uninstall') !== undefined) {
  void app.whenReady().then(async () => app.exit(await runUninstall().catch(() => UNINSTALL_CONTINUE)))
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const url = nxmIn(argv)
    const shard = shardIn(argv)
    // Link aus einer zweiten Instanz erst annehmen, wenn der Core fertig geladen ist
    if (url) void ready.then((ok) => (ok ? core.handleNxm(url) : undefined))
    if (shard) void ready.then((ok) => (ok ? core.openShardPath(shard) : undefined))
  })
  let markReady: (ok: boolean) => void = () => undefined
  const ready = new Promise<boolean>((r) => (markReady = r))
  app.whenReady().then(async () => {
    // Bis die Einstellungen gelesen sind (auch für die Fehlerbox, falls das scheitert): Windows-Sprache
    setLang(resolveLang('auto', app.getPreferredSystemLanguages()))
    try {
      await core.init()
    } catch (err) {
      // Ohne Fenster würde der Prozess sonst unsichtbar weiterlaufen und jeden neuen Start blockieren
      markReady(false)
      dialog.showErrorBox(t('main.app.startFailed', BRAND.name), `${(err as Error).message}\n\n${t('main.app.settingsAt', app.getPath('userData'))}`)
      app.exit(1)
      return
    }
    markReady(true)
    if (envNexusKey) {
      try {
        const st = await core.nexus.setKey(envNexusKey)
        console.log(`Nexus-Key gespeichert: ${st.user?.name} (${st.user?.premium ? 'Premium' : 'Free'}), nxm: ${st.nxm}`)
      } catch (err) {
        console.error('Nexus-Key abgelehnt:', (err as Error).message)
      }
    }
    await createWindow()
    const url = nxmIn(process.argv)
    if (url) void core.handleNxm(url)
    const shard = shardIn(process.argv)
    if (shard) void core.openShardPath(shard)
    void core.backgroundNexus()
  })
  app.on('window-all-closed', () => {
    core.watcher.dispose()
    core.nexus?.dispose()
    app.quit()
  })
  // Eine laufende Änderung am Spielordner erst zu Ende bringen (sonst fehlt sie im Manifest); höchstens 2 min
  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    quitting = true
    e.preventDefault()
    void Promise.race([core.idle(), new Promise((r) => setTimeout(r, 120_000))]).finally(() => app.quit())
  })
}
