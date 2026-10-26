import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import { analyze } from '../src/main/install/analyze'
import { keyOf, readJson, writeJson } from '../src/main/util/paths'
import { exists, makeZip, peekFrom, tmpDir, writeTree } from './helpers'

// Regressionen aus dem Review 2026-10-25: Randfälle, in denen der Spielordner kaputt oder unsauber zurückblieb.

const VANILLA = {
  'bin/x64/Cyberpunk2077.exe': 'MZ fake',
  'archive/pc/mod/.keep': '',
  'r6/cache/final.redscripts': 'vanilla-scripts',
  'r6/scripts/.keep': '',
  'engine/config/platform/pc/rendering.ini': 'vanilla-ini',
}

async function setup(running = false) {
  const base = await tmpDir('fixes')
  const game = path.join(base, 'game')
  const user = path.join(base, 'user')
  await writeTree(game, VANILLA)
  await writeTree(user, { 'settings.json': JSON.stringify({ gameRoot: game, dataRoot: path.join(base, 'data') }) })
  const notes: { tone: string; title: string; body?: string }[] = []
  const state = { running }
  const core = new Core({
    userData: user,
    openUrl: async () => undefined,
    emit: (e, p) => e === 'notify' && notes.push(p as (typeof notes)[number]),
    gameRunning: async () => state.running,
  })
  await core.init()
  const g = (rel: string) => path.join(game, ...rel.split('/'))
  const install = async (name: string, files: Record<string, string>, replace = false) => {
    const { previews, failures } = await core.prepare([await makeZip(base, name, files)])
    expect(failures).toEqual([])
    const out = await core.commitImport({ token: previews[0].token, unknown: 'skip', replace })
    if (!out.ok) throw new Error(out.error)
    return out.mod
  }
  return { base, core, g, install, notes, state }
}

describe('Deployer-Randfälle', () => {
  it('Verlinken scheitert nach dem Sichern: Original kommt sofort zurück, Fehler wird gemeldet', async () => {
    const { core, g, install, notes } = await setup()
    const m = await install('Ini.zip', { 'engine/config/platform/pc/rendering.ini': 'modded-ini' })
    await core.setEnabled(m.id, false)
    await fs.rm(core.mods.stagedPath(m.id, 'engine/config/platform/pc/rendering.ini'))
    await core.setEnabled(m.id, true)
    expect(await fs.readFile(g('engine/config/platform/pc/rendering.ini'), 'utf8')).toBe('vanilla-ini')
    expect(notes.some((n) => n.title === 'DEPLOY-PROBLEME')).toBe(true)
    expect(Object.keys(core.deployer!.manifest.backups)).toEqual([])
  })

  it('eigener Link ohne Manifest-Eintrag (Absturz) wird übernommen, nicht als Original gesichert', async () => {
    const { core, g, install } = await setup()
    const m = await install('A.zip', { 'archive/pc/mod/a.archive': 'A' })
    const k = keyOf('archive/pc/mod/a.archive')
    delete core.deployer!.manifest.files[k]
    await core.deployer!.save()
    await core.setEnabled(m.id, true) // erneut anwenden
    expect(core.deployer!.manifest.backups[k]).toBeUndefined()
    expect(core.deployer!.manifest.files[k]).toBeDefined()
    await core.removeMod(m.id)
    expect(await exists(g('archive/pc/mod/a.archive'))).toBe(false)
    expect((await core.purge()).vanilla?.identical).toBe(true)
  })

  it('fremde Dateien in einem gemeinsamen Mod-Ordner, den RIPPERDOC angelegt hat, bleiben liegen', async () => {
    const { core, g, install } = await setup()
    const m = await install('Tweak.zip', { 'r6/tweaks/fast.yaml': 'x' })
    await fs.writeFile(g('r6/tweaks/manual.yaml'), 'von Hand')
    await core.setEnabled(m.id, false)
    expect(await fs.readFile(g('r6/tweaks/manual.yaml'), 'utf8')).toBe('von Hand')
    expect(await exists(g('r6/tweaks/fast.yaml'))).toBe(false)
    await fs.rm(g('r6/tweaks/manual.yaml'))
    await core.setEnabled(m.id, true)
    await core.setEnabled(m.id, false)
    expect(await exists(g('r6/tweaks'))).toBe(false) // leer → weg
  })

  it('Update übernimmt gerettete Laufzeit-Einstellungen des alten Mods', async () => {
    const { core, g, install } = await setup()
    const v1 = await install('Foo-100-1-0-1700000000.zip', { 'Foo/init.lua': 'v1' })
    const settings = 'bin/x64/plugins/cyber_engine_tweaks/mods/Foo/settings.json'
    await fs.writeFile(g(settings), '{"mine":true}')
    await core.setEnabled(v1.id, false) // rettet settings.json nach overwrite/
    await core.setEnabled(v1.id, true)
    expect(await fs.readFile(g(settings), 'utf8')).toBe('{"mine":true}')
    const v2 = await install('Foo-100-2-0-1710000000.zip', { 'Foo/init.lua': 'v2' }, true)
    expect(core.mods.mods.has(v1.id)).toBe(false)
    expect(await fs.readFile(g('bin/x64/plugins/cyber_engine_tweaks/mods/Foo/init.lua'), 'utf8')).toBe('v2')
    expect(await fs.readFile(g(settings), 'utf8')).toBe('{"mine":true}')
    expect(core.deployer!.manifest.overwrite[keyOf(settings)].owner).toBe(v2.id)
  })

  it('nach einem Spiel-Patch bleibt r6/cache unberührt (neue Cache-Dateien sind echte Spieldateien)', async () => {
    const { core, g, install } = await setup()
    const m = await install('A.zip', { 'archive/pc/mod/a.archive': 'A' })
    core.snapshot!.build = 'alter-build'
    await fs.writeFile(g('r6/cache/tweakdb_ep1.bin'), 'neu vom Patch')
    await core.setEnabled(m.id, false)
    expect(await fs.readFile(g('r6/cache/tweakdb_ep1.bin'), 'utf8')).toBe('neu vom Patch')
    const report = await core.purge()
    expect(await exists(g('r6/cache/tweakdb_ep1.bin'))).toBe(true)
    expect(report.errors.join(' ')).toMatch(/r6\/cache nicht geprüft/)
  })

  it('fehlende Sicherung blockiert PURGE nicht mehr', async () => {
    const { core, install } = await setup()
    await install('Ini.zip', { 'engine/config/platform/pc/rendering.ini': 'modded-ini' })
    const [b] = Object.values(core.deployer!.manifest.backups)
    await fs.rm(b.backup)
    const report = await core.purge()
    expect(report.errors.join(' ')).toMatch(/Sicherung fehlt/)
    expect(core.deployer!.manifest.backups).toEqual({})
  })

  it('läuft das Spiel (auch ohne eigenen Start), ändert RIPPERDOC nichts; VANILLA MODE bleibt bei Fehlschlag', async () => {
    const { core, g, install, state } = await setup()
    const m = await install('A.zip', { 'archive/pc/mod/a.archive': 'A' })
    await core.purge()
    state.running = true
    await core.setEnabled(m.id, false) // im VANILLA MODE geht das (nur Auswahl)
    await core.setEnabled(m.id, true)
    await expect(core.redeploy()).rejects.toThrow(/läuft/)
    expect((await core.inventory()).deploy.suspended).toBe(true)
    expect(await exists(g('archive/pc/mod/a.archive'))).toBe(false)
    state.running = false
    await core.redeploy()
    state.running = true
    await expect(core.setEnabled(m.id, false)).rejects.toThrow(/läuft/)
    expect(core.profiles.profile.enabled[m.id]).toBe(true)
    await expect(core.removeMod(m.id)).rejects.toThrow(/läuft/)
    expect(core.profiles.profile.enabled[m.id]).toBe(true)
    expect(core.mods.mods.has(m.id)).toBe(true)
  })
})

describe('Import-Randfälle', () => {
  it('Hauptordner als eigene Variante neben einem Optional-Ordner', async () => {
    const files = ['Foo.archive', 'Optional/Foo.archive', 'readme.txt']
    const opts = { archiveName: 'Foo.zip', peek: peekFrom({}) }
    expect((await analyze(files, opts)).variants).toEqual(['', 'Optional'])
    const main = await analyze(files, { ...opts, variant: '' })
    expect(main.mapped).toEqual([{ src: 'Foo.archive', dst: 'archive/pc/mod/Foo.archive' }])
    const opt = await analyze(files, { ...opts, variant: 'Optional' })
    expect(opt.mapped).toEqual([{ src: 'Optional/Foo.archive', dst: 'archive/pc/mod/Foo.archive' }])
  })

  it('"Unbekanntes in die Spielwurzel" behält die erkannten Abhängigkeiten', async () => {
    const { base, core } = await setup()
    const zip = await makeZip(base, 'Reds.zip', { 'Reds/r6/scripts/x/a.reds': 'import Codeware.*\nfunc A() {}', 'Reds/extras/notes.cfg': 'n' })
    const { previews } = await core.prepare([zip])
    expect(previews[0].requires).toContain('codeware')
    const out = await core.commitImport({ token: previews[0].token, unknown: 'root' })
    if (!out.ok) throw new Error(out.error)
    expect(out.mod.requires).toEqual(previews[0].requires)
  })
})

describe('writeJson', () => {
  it('viele gleichzeitige Schreibvorgänge: keiner scheitert, der letzte gewinnt', async () => {
    const file = path.join(await tmpDir('json'), 'settings.json')
    await Promise.all(Array.from({ length: 25 }, (_, i) => writeJson(file, { i })))
    expect(await readJson(file, null)).toEqual({ i: 24 })
    expect((await fs.readdir(path.dirname(file))).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
