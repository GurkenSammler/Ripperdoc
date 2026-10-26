import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import type { LocateSources } from '../src/main/game/locate'
import { exists, makeZip, tmpDir, writeTree } from './helpers'

// Erster Start auf einem fremden PC: frischer userData-Ordner, Spiel irgendwo (Steam/GOG/Epic/nirgends).
// Die Quellen sind ausgetauscht, damit der echte PC (und David's echtes Spiel) keine Rolle spielt.

const GAME = {
  'bin/x64/Cyberpunk2077.exe': 'MZ fake',
  'archive/pc/content/basegame_1.archive': 'BASE',
  'archive/pc/mod/.keep': '',
  'r6/cache/final.redscripts': 'vanilla-scripts',
}

const NOWHERE: LocateSources = { steamRoot: async () => null, gogPaths: async () => [], epicManifestDirs: async () => [] }

const cores: Core[] = []
afterEach(() => {
  for (const c of cores.splice(0)) {
    c.watcher.dispose()
    c.nexus?.dispose()
  }
})

async function steamLayout(base: string, game: Record<string, string> = GAME) {
  const steam = path.join(base, 'Steam')
  await writeTree(steam, {
    'steamapps/libraryfolders.vdf': `"libraryfolders"\n{\n  "0"\n  {\n    "path"  "${steam.replace(/\\/g, '\\\\')}"\n    "apps" { "1091500" "1" }\n  }\n}`,
    'steamapps/appmanifest_1091500.acf': '"AppState"\n{\n  "appid" "1091500"\n  "installdir" "Cyberpunk 2077"\n}',
  })
  const root = path.join(steam, 'steamapps', 'common', 'Cyberpunk 2077')
  await writeTree(root, game)
  return { steam, root }
}

async function firstStart(sources: LocateSources) {
  const base = await tmpDir('first')
  const user = path.join(base, 'user')
  // Steht für "<Laufwerk des Spiels>\RipperdocData", ohne echte Laufwerke anzufassen
  const dataFor = (g: string | null) => (g ? path.join(base, `data-${path.basename(g).replace(/\W/g, '')}`) : path.join(user, 'RipperdocData'))
  const opened = { urls: [] as string[] }
  const make = async () => {
    const core = new Core({
      userData: user,
      openUrl: async (u) => void opened.urls.push(u),
      emit: () => undefined,
      gameRunning: async () => false,
      locate: sources,
      dataRootFor: dataFor,
    })
    cores.push(core)
    await core.init()
    return core
  }
  const settingsFile = async () => JSON.parse(await fs.readFile(path.join(user, 'settings.json'), 'utf8').catch(() => '{}'))
  return { base, user, dataFor, make, settingsFile, opened }
}

async function install(core: Core, zip: string) {
  const { previews, failures } = await core.prepare([zip])
  expect(failures).toEqual([])
  const out = await core.commitImport({ token: previews[0].token, unknown: 'skip' })
  if (!out.ok) throw new Error(out.error)
  return out.mod
}

describe('Erster Start', () => {
  beforeEach(() => {
    // Fake-exe hat keine Versionsinfo; die Warnung dazu ist hier gewollt
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('findet Steam von selbst und legt den Datenordner fest aufs Laufwerk des Spiels', async () => {
    const t0 = await tmpDir('first-steam')
    const { steam, root } = await steamLayout(t0)
    const t = await firstStart({ ...NOWHERE, steamRoot: async () => steam })
    const core = await t.make()
    expect(core.game.found).toBe(true)
    expect(core.game.store).toBe('steam')
    expect(core.game.root).toBe(root)
    expect(core.dataRoot).toBe(t.dataFor(root))
    expect(core.deployer).not.toBeNull()
    // fest gespeichert, damit ein späterer Start ohne Spiel die Mods nicht "verliert"
    const s = await t.settingsFile()
    expect(s.dataRoot).toBe(core.dataRoot)
    expect(s.gameRoot).toBeNull()
  })

  it('ohne Fund: Hinweis auf SYS.CONFIG, Ordner wählen (auch bin\\x64), Neustart, läuft', async () => {
    const t = await firstStart(NOWHERE)
    const game = path.join(t.base, 'Games', 'Cyberpunk 2077')
    await writeTree(game, GAME)

    const core = await t.make()
    expect(core.game.found).toBe(false)
    expect(core.game.error).toMatch(/Steam, GOG, Epic/)
    expect(core.game.error).toMatch(/SYS\.CONFIG/)
    expect(core.dataRoot).toBe(t.dataFor(null))
    expect((await t.settingsFile()).dataRoot ?? null).toBeNull() // Ersatzordner wird nicht festgeschrieben

    const r = await core.setGameRoot(path.join(game, 'bin', 'x64'))
    expect(r.restart).toBe(true)
    expect(r.game.root).toBe(game)
    const s = await t.settingsFile()
    expect(s.gameRoot).toBe(game)
    expect(s.dataRoot).toBe(t.dataFor(game))

    // Neustart
    const again = await t.make()
    expect(again.game.found).toBe(true)
    expect(again.game.store).toBe('manual')
    expect(again.dataRoot).toBe(t.dataFor(game))
    expect(again.deployer).not.toBeNull()
  })

  it('falscher Ordner: klare Meldung, nichts gespeichert', async () => {
    const t = await firstStart(NOWHERE)
    const core = await t.make()
    const wrong = path.join(t.base, 'Downloads')
    await fs.mkdir(wrong, { recursive: true })
    await expect(core.setGameRoot(wrong)).rejects.toThrow(/Keine Cyberpunk2077\.exe/)
    expect((await t.settingsFile()).gameRoot ?? null).toBeNull()
    await expect(core.setGameRoot(null)).rejects.toThrow(/nicht gefunden/)
  })

  it('Ordner wechseln nur nach PURGE; danach neuer Snapshot für die neue Installation', async () => {
    const t = await firstStart(NOWHERE)
    const first = path.join(t.base, 'A', 'Cyberpunk 2077')
    const second = path.join(t.base, 'B', 'Cyberpunk 2077')
    await writeTree(first, GAME)
    await writeTree(second, GAME)
    let core = await t.make()
    expect((await core.setGameRoot(first)).restart).toBe(true)
    core = await t.make()

    const zip = await makeZip(t.base, 'Mod.zip', { 'archive/pc/mod/m.archive': 'M' })
    await install(core, zip)
    expect(await exists(path.join(first, 'archive', 'pc', 'mod', 'm.archive'))).toBe(true)
    expect(core.snapshot).not.toBeNull()

    await expect(core.setGameRoot(second)).rejects.toThrow(/PURGE/)
    expect(core.game.root).toBe(first)

    await core.purge()
    const r = await core.setGameRoot(second)
    expect(r.restart).toBe(false) // Datenordner ist längst fest, die Mods bleiben, wo sie sind
    expect(core.game.root).toBe(second)
    expect(core.snapshot).toBeNull()
    expect(await exists(core.snapshotFile)).toBe(false)
    expect((await fs.readdir(core.dataRoot)).some((n) => /^snapshot-vanilla\.old-\d+\.json$/.test(n))).toBe(true)
    // nichts in der neuen Installation angefasst, die alte ist wieder vanilla
    expect(await exists(path.join(second, 'archive', 'pc', 'mod', 'm.archive'))).toBe(false)
    expect(await exists(path.join(first, 'archive', 'pc', 'mod', 'm.archive'))).toBe(false)
  })

  it('zurück auf automatisch: findet die Steam-Fassung wieder', async () => {
    const t0 = await tmpDir('first-auto')
    const { steam, root } = await steamLayout(t0)
    const t = await firstStart({ ...NOWHERE, steamRoot: async () => steam })
    const other = path.join(t.base, 'Other', 'Cyberpunk 2077')
    await writeTree(other, GAME)
    const core = await t.make()
    expect(core.game.root).toBe(root)
    await core.setGameRoot(other)
    expect(core.game.store).toBe('manual')
    const r = await core.setGameRoot(null)
    expect(r.restart).toBe(false)
    expect(core.game.store).toBe('steam')
    expect(core.game.root).toBe(root)
    expect((await t.settingsFile()).gameRoot).toBeNull()
  })
})

describe('Start des Spiels je nach Fassung', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('Steam-Fassung im Steam-Modus: über steam://', async () => {
    const t0 = await tmpDir('launch-steam')
    const { steam } = await steamLayout(t0)
    const t = await firstStart({ ...NOWHERE, steamRoot: async () => steam })
    const core = await t.make()
    await core.settings.patch({ launchMode: 'steam' })
    await core.launch()
    expect(t.opened.urls).toEqual(['steam://rungameid/1091500'])
  })

  it('GOG-Fassung: nie über Steam, auch wenn Steam eingestellt ist', async () => {
    const t0 = await tmpDir('launch-gog')
    const gog = path.join(t0, 'GOG Games', 'Cyberpunk 2077')
    await writeTree(gog, GAME)
    const t = await firstStart({ ...NOWHERE, gogPaths: async () => [gog] })
    const core = await t.make()
    expect(core.game.store).toBe('gog')
    await core.settings.patch({ launchMode: 'steam' })
    // Die Fake-exe ist keine echte exe: Der Startversuch zeigt, dass der direkte Weg genommen wurde
    await expect(core.launch()).rejects.toThrow(/Spiel ließ sich nicht starten/)
    expect(t.opened.urls).toEqual([])
  })
})
