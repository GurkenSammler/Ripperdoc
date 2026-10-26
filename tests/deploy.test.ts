import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import { exists, ino, makeZip, tmpDir, writeTree } from './helpers'

// Kompletter Durchlauf im Fake-Spielordner: echte zip-Dateien, echte Hardlinks, echtes Journal.

const VANILLA = {
  'bin/x64/Cyberpunk2077.exe': 'MZ fake',
  'archive/pc/content/basegame_1.archive': 'BASE',
  'archive/pc/mod/.keep': '',
  'r6/cache/final.redscripts': 'vanilla-scripts',
  'r6/scripts/.keep': '',
  'engine/config/platform/pc/rendering.ini': 'vanilla-ini',
}

async function setup() {
  const base = await tmpDir('deploy')
  const game = path.join(base, 'game')
  const data = path.join(base, 'data')
  const user = path.join(base, 'user')
  await writeTree(game, VANILLA)
  await writeTree(user, { 'settings.json': JSON.stringify({ gameRoot: game, dataRoot: data }) })
  const events: string[] = []
  const core = new Core({ userData: user, openUrl: async () => undefined, emit: (e) => events.push(e) })
  await core.init()
  const g = (rel: string) => path.join(game, ...rel.split('/'))
  return { base, game, data, core, g }
}

async function install(core: Core, zip: string) {
  const { previews, failures } = await core.prepare([zip])
  expect(failures).toEqual([])
  const out = await core.commitImport({ token: previews[0].token, unknown: 'skip' })
  if (!out.ok) throw new Error(out.error)
  return out.mod
}

describe('Deployer im Fake-Spielordner', () => {
  it('installiert, löst Konflikte nach Reihenfolge, rettet Laufzeitdateien und kommt per PURGE zurück auf vanilla', async () => {
    const { base, core, g } = await setup()
    expect(core.game.found).toBe(true)

    const zipA = await makeZip(base, 'ModA.zip', { 'archive/pc/mod/a.archive': 'A', 'r6/scripts/A/a.reds': 'A script' })
    const zipB = await makeZip(base, 'ModB.zip', { 'stuff/a.archive': 'B', 'stuff/b.archive': 'B2' })

    // A installieren → Hardlink + Snapshot + Vanilla-Kopie von r6/cache
    const a = await install(core, zipA)
    expect(await fs.readFile(g('archive/pc/mod/a.archive'), 'utf8')).toBe('A')
    expect(await ino(g('archive/pc/mod/a.archive'))).toBe(await ino(core.mods.stagedPath(a.id, 'archive/pc/mod/a.archive')))
    expect(core.snapshot).not.toBeNull()
    expect(await exists(path.join(core.vanillaCacheDir, 'r6', 'cache', 'final.redscripts'))).toBe(true)

    // B kommt oben drauf und gewinnt a.archive
    const b = await install(core, zipB)
    expect(await fs.readFile(g('archive/pc/mod/a.archive'), 'utf8')).toBe('B')
    let inv = await core.inventory()
    expect(inv.conflicts).toEqual([{ dst: 'archive/pc/mod/a.archive', winner: b.id, losers: [a.id] }])
    expect(inv.missing).toEqual([{ modId: a.id, framework: 'redscript' }])

    // Reihenfolge tauschen → A gewinnt
    await core.move(b.id, 1)
    expect(await fs.readFile(g('archive/pc/mod/a.archive'), 'utf8')).toBe('A')

    // Laufzeitdatei in A's Ordner, dann A aus → gerettet, Ordner weg, r6/scripts (vanilla) bleibt
    await fs.writeFile(g('r6/scripts/A/generated.log'), 'runtime')
    await core.setEnabled(a.id, false)
    expect(await exists(g('r6/scripts/A'))).toBe(false)
    expect(await exists(g('r6/scripts'))).toBe(true)
    expect(await fs.readFile(g('archive/pc/mod/a.archive'), 'utf8')).toBe('B')
    expect(await exists(path.join(core.dataRoot, 'overwrite', 'r6', 'scripts', 'A', 'generated.log'))).toBe(true)

    // A wieder an → die gerettete Datei kommt mit zurück
    await core.setEnabled(a.id, true)
    expect(await fs.readFile(g('r6/scripts/A/generated.log'), 'utf8')).toBe('runtime')

    // Fremde Datei im Mod-Ordner wird gemeldet, aber nie angefasst
    await fs.writeFile(g('archive/pc/mod/manual.archive'), 'manual')
    expect((await core.verify()).unmanaged).toEqual(['archive/pc/mod/manual.archive'])
    await fs.unlink(g('archive/pc/mod/manual.archive'))

    // Mod überschreibt eine Spieldatei → Sicherung, beim Abschalten zurück
    const zipC = await makeZip(base, 'ModC.zip', { 'engine/config/platform/pc/rendering.ini': 'modded-ini' })
    const c = await install(core, zipC)
    expect(await fs.readFile(g('engine/config/platform/pc/rendering.ini'), 'utf8')).toBe('modded-ini')
    await core.setEnabled(c.id, false)
    expect(await fs.readFile(g('engine/config/platform/pc/rendering.ini'), 'utf8')).toBe('vanilla-ini')
    await core.setEnabled(c.id, true)

    // Laufzeit-Änderung am Script-Cache (wie redscript) → PURGE setzt zurück
    await fs.writeFile(g('r6/cache/final.redscripts'), 'modded-scripts')
    await writeTree(path.join(core.game.root), { 'r6/cache/modded/final.redscripts': 'x' })

    const report = await core.purge()
    expect(report.errors).toEqual([])
    expect(report.vanilla?.identical).toBe(true)
    expect(await fs.readFile(g('engine/config/platform/pc/rendering.ini'), 'utf8')).toBe('vanilla-ini')
    expect(await fs.readFile(g('r6/cache/final.redscripts'), 'utf8')).toBe('vanilla-scripts')
    expect(await exists(g('r6/cache/modded/final.redscripts'))).toBe(false)
    expect(await exists(g('archive/pc/mod/a.archive'))).toBe(false)
    expect(await fs.readFile(g('archive/pc/content/basegame_1.archive'), 'utf8')).toBe('BASE')

    // VANILLA-Modus: Schalter ändern nur das Profil, RE-DEPLOY spielt alles wieder ein
    inv = await core.inventory()
    expect(inv.deploy.suspended).toBe(true)
    await core.setEnabled(b.id, false)
    expect(await exists(g('archive/pc/mod/b.archive'))).toBe(false)
    await core.redeploy()
    expect(await fs.readFile(g('archive/pc/mod/a.archive'), 'utf8')).toBe('A')
    expect(await exists(g('archive/pc/mod/b.archive'))).toBe(false)

    // Journal hat jeden Schritt
    const ops = new Set((await core.journal.tail(1000)).map((e) => e.op))
    for (const op of ['snapshot', 'mkdir', 'link', 'unlink', 'rescue', 'backup', 'restore', 'restore-cache', 'cache-extra', 'purge', 'redeploy']) {
      expect(ops.has(op), op).toBe(true)
    }
  })

  it('Entfernen eines Mods räumt Spielordner und Staging', async () => {
    const { base, core, g } = await setup()
    const zip = await makeZip(base, 'Cet.zip', { 'MyCet/init.lua': 'print(1)' })
    const m = await install(core, zip)
    const target = 'bin/x64/plugins/cyber_engine_tweaks/mods/MyCet/init.lua'
    expect(await exists(g(target))).toBe(true)
    await core.removeMod(m.id)
    expect(await exists(g('bin/x64/plugins'))).toBe(false)
    expect(await exists(g('bin/x64/Cyberpunk2077.exe'))).toBe(true)
    expect(await exists(path.join(core.dataRoot, 'mods', m.id))).toBe(false)
    expect(core.profiles.profile.order).toEqual([])
  })

  it('Unbekannte Dateien "in die Spielwurzel" landen relativ zum erkannten Wurzel-Ordner', async () => {
    const { base, core, g } = await setup()
    const zip = await makeZip(base, 'Road Signs.zip', { 'RoadSigns/archive/pc/mod/signs.archive': 's', 'RoadSigns/extras/signs.psd': 'p' })
    const { previews } = await core.prepare([zip])
    expect(previews[0].unknown).toEqual(['RoadSigns/extras/signs.psd'])
    const out = await core.commitImport({ token: previews[0].token, unknown: 'root' })
    if (!out.ok) throw new Error(out.error)
    expect(await exists(g('extras/signs.psd'))).toBe(true)
    expect(await exists(g('RoadSigns'))).toBe(false)
  })

  it('Update über gleichen Namen übernimmt Platz und Schalter', async () => {
    const { base, core, g } = await setup()
    const v1 = await install(core, await makeZip(base, 'Neon-100-1-0-1700000000.zip', { 'neon.archive': 'v1' }))
    const other = await install(core, await makeZip(base, 'Other.zip', { 'other.archive': 'o' }))
    expect(core.profiles.profile.order).toEqual([other.id, v1.id])

    const zip2 = await makeZip(base, 'Neon-100-2-0-1710000000.zip', { 'neon.archive': 'v2' })
    const { previews } = await core.prepare([zip2])
    expect(previews[0].replaces).toBe(v1.id)
    const out = await core.commitImport({ token: previews[0].token, unknown: 'skip', replace: true })
    if (!out.ok) throw new Error(out.error)
    expect(out.mod.version).toBe('2.0')
    expect(core.profiles.profile.order).toEqual([other.id, out.mod.id])
    expect(await fs.readFile(g('archive/pc/mod/neon.archive'), 'utf8')).toBe('v2')
    expect(core.mods.mods.has(v1.id)).toBe(false)
  })
})
