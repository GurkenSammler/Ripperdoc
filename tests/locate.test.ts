import { existsSync } from 'node:fs'
import path from 'node:path'
import { readPeVersion } from '../src/main/game/peversion'
import {
  epicManifestDirs,
  findInEpic,
  findInSteam,
  gogPaths,
  locateGame,
  normalizeGameRoot,
  steamRoot,
  type LocateSources,
} from '../src/main/game/locate'
import { child, parseVdf, value } from '../src/main/game/vdf'
import { tmpDir, writeTree } from './helpers'

const EXE = { 'bin/x64/Cyberpunk2077.exe': 'MZ fake' }
const NOWHERE: LocateSources = { steamRoot: async () => null, gogPaths: async () => [], epicManifestDirs: async () => [] }
const esc = (p: string) => p.replace(/\\/g, '\\\\')

/** Steam mit zwei Bibliotheken; Cyberpunk liegt in der zweiten (wie bei David auf E:). */
async function fakeSteam(base: string, opts: { exe?: boolean; pl?: boolean } = {}) {
  const steam = path.join(base, 'Steam')
  const lib2 = path.join(base, 'SteamLibrary')
  await writeTree(steam, {
    'steamapps/libraryfolders.vdf': `"libraryfolders"
{
  "0" { "path" "${esc(steam)}" "apps" { "228980" "1" } }
  "1" { "path" "${esc(lib2)}" "apps" { "1091500" "70000000000" } }
}`,
  })
  await writeTree(lib2, {
    'steamapps/appmanifest_1091500.acf': `"AppState"
{
  "appid" "1091500"
  "installdir" "Cyberpunk 2077"
  "InstalledDepots"
  {
    "1091501" { "manifest" "1" "size" "1" }
    ${opts.pl === false ? '' : '"2138331" { "manifest" "2" "size" "1" "dlcappid" "2138330" }'}
  }
  "UserConfig" { "language" "german" }
}`,
  })
  const root = path.join(lib2, 'steamapps', 'common', 'Cyberpunk 2077')
  if (opts.exe !== false) await writeTree(root, EXE)
  return { steam, root }
}

describe('Spiel finden (Fake-PC)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined) // Fake-exe ohne Versionsinfo
  })

  it('Steam: zweite Bibliothek, Phantom Liberty und Sprache aus dem Manifest', async () => {
    const base = await tmpDir('loc-steam')
    const { steam, root } = await fakeSteam(base)
    const g = await locateGame(null, null, { ...NOWHERE, steamRoot: async () => steam })
    expect(g).toMatchObject({ found: true, store: 'steam', root, phantomLiberty: true, language: 'german', patch: '?' })
    expect(g.build).toMatch(/^size-\d+$/)
  })

  it('Steam ohne Phantom Liberty', async () => {
    const base = await tmpDir('loc-nopl')
    const { steam } = await fakeSteam(base, { pl: false })
    expect((await locateGame(null, null, { ...NOWHERE, steamRoot: async () => steam })).phantomLiberty).toBe(false)
  })

  it('Steam-Manifest ohne exe (halb deinstalliert) → weiter zu GOG', async () => {
    const base = await tmpDir('loc-half')
    const { steam } = await fakeSteam(base, { exe: false })
    const gog = path.join(base, 'GOG Games', 'Cyberpunk 2077')
    await writeTree(gog, { ...EXE, 'archive/pc/ep1/ep1_1.archive': 'PL' })
    const g = await locateGame(null, null, { steamRoot: async () => steam, gogPaths: async () => [gog], epicManifestDirs: async () => [] })
    expect(g).toMatchObject({ found: true, store: 'gog', root: gog, phantomLiberty: true, language: '' })
  })

  it('GOG: nimmt den Eintrag, unter dem wirklich Cyberpunk liegt', async () => {
    const base = await tmpDir('loc-gog')
    const witcher = path.join(base, 'GOG Games', 'The Witcher 3')
    const cp = path.join(base, 'GOG Games', 'Cyberpunk 2077')
    await writeTree(witcher, { 'bin/x64/witcher3.exe': 'MZ' })
    await writeTree(cp, EXE)
    const g = await locateGame(null, null, { ...NOWHERE, gogPaths: async () => [witcher, cp] })
    expect(g).toMatchObject({ found: true, store: 'gog', root: cp, phantomLiberty: false })
  })

  it('Epic: liest die .item-Manifeste, übersteht kaputte Dateien', async () => {
    const base = await tmpDir('loc-epic')
    const manifests = path.join(base, 'Epic', 'Manifests')
    const cp = path.join(base, 'Epic Games', 'Cyberpunk2077')
    const fortnite = path.join(base, 'Epic Games', 'Fortnite')
    await writeTree(cp, EXE)
    await writeTree(manifests, {
      'AAA.item': '{ "DisplayName": "Fort', // halb geschrieben
      'BBB.item': JSON.stringify({ DisplayName: 'Fortnite', InstallLocation: fortnite }),
      'CCC.item': JSON.stringify({ DisplayName: 'Cyberpunk 2077', InstallLocation: cp }),
      'notes.txt': JSON.stringify({ InstallLocation: 'X:\\nope' }),
    })
    expect(await findInEpic([path.join(base, 'fehlt'), manifests])).toBe(cp)
    const g = await locateGame(null, null, { ...NOWHERE, epicManifestDirs: async () => [manifests] })
    expect(g).toMatchObject({ found: true, store: 'epic', root: cp })
  })

  it('Reihenfolge: Steam vor GOG vor Epic', async () => {
    const base = await tmpDir('loc-order')
    const { steam, root } = await fakeSteam(base)
    const gog = path.join(base, 'GOG', 'Cyberpunk 2077')
    await writeTree(gog, EXE)
    expect((await locateGame(null, null, { ...NOWHERE, steamRoot: async () => steam, gogPaths: async () => [gog] })).root).toBe(root)
  })

  it('nirgends gefunden → Hinweis, wo man den Ordner setzt', async () => {
    const g = await locateGame(null, 'alt', NOWHERE)
    expect(g.found).toBe(false)
    expect(g.error).toMatch(/Steam, GOG, Epic.*SYS\.CONFIG/)
    expect(g.previousBuild).toBe('alt')
  })

  it('von Hand gesetzter Ordner hat Vorrang, ein falscher wird gemeldet', async () => {
    const base = await tmpDir('loc-manual')
    const { steam } = await fakeSteam(base)
    const own = path.join(base, 'Spiele', 'CP')
    await writeTree(own, EXE)
    const src = { ...NOWHERE, steamRoot: async () => steam }
    expect(await locateGame(own, null, src)).toMatchObject({ found: true, store: 'manual', root: own })
    const wrong = await locateGame(path.join(base, 'leer'), null, src)
    expect(wrong.found).toBe(false)
    expect(wrong.error).toMatch(/Keine Cyberpunk2077\.exe/)
  })

  it('Ordnerwahl verzeiht bin\\x64 und die exe selbst', async () => {
    const base = await tmpDir('loc-norm')
    const root = path.join(base, 'Cyberpunk 2077')
    await writeTree(root, EXE)
    expect(await normalizeGameRoot(root)).toBe(root)
    expect(await normalizeGameRoot(path.join(root, 'bin', 'x64'))).toBe(root)
    expect(await normalizeGameRoot(path.join(root, 'bin', 'x64', 'Cyberpunk2077.exe'))).toBe(root)
    expect(await normalizeGameRoot(path.join(base, 'anderes'))).toBe(path.join(base, 'anderes'))
  })
})

describe('vdf', () => {
  it('liest verschachtelte Blöcke und Escapes', () => {
    const v = parseVdf(`"libraryfolders"
{
  "0"
  {
    "path"   "E:\\\\programme\\\\steam"
    "apps" { "1091500" "123" }
  }
}`)
    const lib = child(child(v, 'libraryfolders'), '0')
    expect(value(lib, 'path')).toBe('E:\\programme\\steam')
    expect(value(child(lib, 'apps'), '1091500')).toBe('123')
  })
})

// Nur lesend, am echten Spiel auf diesem PC (wird übersprungen, wo es fehlt)
const REAL = 'E:\\programme\\steam\\steamapps\\common\\Cyberpunk 2077'
describe.skipIf(!existsSync(REAL))('echtes Spiel (nur lesen)', () => {
  it('findet Cyberpunk über Steam', async () => {
    const steam = await steamRoot()
    expect(steam).not.toBeNull()
    const hit = await findInSteam(steam!)
    expect(hit?.root.toLowerCase()).toBe(REAL.toLowerCase())
    expect(hit?.phantomLiberty).toBe(true)
  })

  it('erster Start ohne Einstellungen findet es automatisch als Steam-Fassung', async () => {
    const g = await locateGame(null, null)
    expect(g).toMatchObject({ found: true, store: 'steam', phantomLiberty: true })
    expect(g.root.toLowerCase()).toBe(REAL.toLowerCase())
    expect(g.patch).toMatch(/^\d+\.\d+/)
  })

  it('GOG/Epic-Suche läuft auf einem PC ohne GOG/Epic ohne Fehler durch', async () => {
    expect(Array.isArray(await gogPaths())).toBe(true)
    expect(await findInEpic(await epicManifestDirs())).toBeNull()
  })

  it('liest die Version aus der exe', async () => {
    const v = await readPeVersion(path.join(REAL, 'bin', 'x64', 'Cyberpunk2077.exe'))
    expect(v.product).toMatch(/^\d+\.\d+/)
    expect(v.file).toMatch(/^\d+\.\d+\.\d+/)
  })
})
