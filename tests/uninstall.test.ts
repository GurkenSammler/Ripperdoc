import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import { UNINSTALL_ABORT, UNINSTALL_CONTINUE, uninstallCleanup, type UninstallChoice } from '../src/main/uninstall'
import { exists, makeZip, tmpDir, writeTree } from './helpers'

// Deinstallieren: Mods im Spielordner → fragen; PURGE, so lassen oder abbrechen. Datenordner bleibt immer.

const GAME = {
  'bin/x64/Cyberpunk2077.exe': 'MZ fake',
  'archive/pc/content/basegame_1.archive': 'BASE',
  'archive/pc/mod/.keep': '',
  'r6/cache/final.redscripts': 'vanilla-scripts',
}

const cores: Core[] = []
afterEach(() => {
  for (const c of cores.splice(0)) {
    c.watcher.dispose()
    c.nexus?.dispose()
  }
})

async function setup(opts: { deploy: boolean; running?: boolean }) {
  const base = await tmpDir('uninstall')
  const game = path.join(base, 'game')
  const data = path.join(base, 'data')
  const user = path.join(base, 'user')
  await writeTree(game, GAME)
  await writeTree(user, { 'settings.json': JSON.stringify({ gameRoot: game, dataRoot: data }) })
  let running = false
  const core = new Core({ userData: user, openUrl: async () => undefined, emit: () => undefined, gameRunning: async () => running })
  cores.push(core)
  await core.init()
  if (opts.deploy) {
    const zip = await makeZip(base, 'Mod.zip', { 'archive/pc/mod/m.archive': 'M' })
    const { previews } = await core.prepare([zip])
    const out = await core.commitImport({ token: previews[0].token, unknown: 'skip' })
    if (!out.ok) throw new Error(out.error)
  }
  running = !!opts.running
  const modFile = path.join(game, 'archive', 'pc', 'mod', 'm.archive')
  return { core, data, modFile }
}

const ui = (choice: UninstallChoice, anyway = false) => {
  const asked: number[] = []
  const failures: string[] = []
  return {
    asked,
    failures,
    ask: async (n: number) => {
      asked.push(n)
      return choice
    },
    failed: async (msg: string) => {
      failures.push(msg)
      return anyway
    },
  }
}

describe('Deinstallieren', () => {
  it('nichts eingebunden: keine Frage, weiter', async () => {
    const { core } = await setup({ deploy: false })
    const u = ui('cancel')
    expect(await uninstallCleanup(core, u)).toBe(UNINSTALL_CONTINUE)
    expect(u.asked).toEqual([])
  })

  it('PURGE: Spielordner wieder vanilla, Mods im Datenordner bleiben', async () => {
    const { core, data, modFile } = await setup({ deploy: true })
    expect(await exists(modFile)).toBe(true)
    const u = ui('purge')
    expect(await uninstallCleanup(core, u)).toBe(UNINSTALL_CONTINUE)
    expect(u.asked).toEqual([1])
    expect(await exists(modFile)).toBe(false)
    expect(core.deployedFiles()).toBe(0)
    expect((await fs.readdir(path.join(data, 'mods'))).length).toBe(1)
  })

  it('so lassen: Mods bleiben im Spiel, weiter', async () => {
    const { core, modFile } = await setup({ deploy: true })
    expect(await uninstallCleanup(core, ui('keep'))).toBe(UNINSTALL_CONTINUE)
    expect(await exists(modFile)).toBe(true)
  })

  it('abbrechen: Deinstallation stoppt, nichts angefasst', async () => {
    const { core, modFile } = await setup({ deploy: true })
    expect(await uninstallCleanup(core, ui('cancel'))).toBe(UNINSTALL_ABORT)
    expect(await exists(modFile)).toBe(true)
  })

  it('Spiel läuft: Meldung, dann je nach Antwort abbrechen oder trotzdem weiter', async () => {
    const a = await setup({ deploy: true, running: true })
    const stop = ui('purge', false)
    expect(await uninstallCleanup(a.core, stop)).toBe(UNINSTALL_ABORT)
    expect(stop.failures).toHaveLength(1)
    expect(await exists(a.modFile)).toBe(true)

    const b = await setup({ deploy: true, running: true })
    expect(await uninstallCleanup(b.core, ui('purge', true))).toBe(UNINSTALL_CONTINUE)
    expect(await exists(b.modFile)).toBe(true)
  })
})
