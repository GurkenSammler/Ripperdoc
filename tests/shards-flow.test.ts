import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import type { Crypto } from '../src/main/nexus/keystore'
import type { NexusFiles } from '../src/main/nexus/updates'
import { encodeShard } from '../src/main/plans'
import type { ImportPreview, Notice } from '../src/shared/types'
import { exists, makeZip, tmpDir, writeTree } from './helpers'

// Collections, Shards, Requirements und Mehrfach-Aktionen gegen ein simuliertes Nexus (v1 + GraphQL + CDN).

const FAKE_CRYPTO: Crypto = {
  available: () => true,
  encrypt: (t) => Buffer.from([...t].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
}
const KEY = 'TEST-KEY-1234567890-abcdef'

interface FakeFile {
  id: number
  name: string
  version: string
  cat: string
  zip: Record<string, string>
}
interface FakeMod {
  id: number
  name: string
  files: FakeFile[]
  requires?: { modId: number; name: string; notes?: string }[]
}

const MODS: FakeMod[] = [
  {
    id: 100,
    name: 'Neon Night Lights',
    files: [{ id: 2, name: 'Neon Main', version: '2.0', cat: 'MAIN', zip: { 'archive/pc/mod/neon.archive': 'neon' } }],
    requires: [
      { modId: 107, name: 'Cyber Engine Tweaks' },
      { modId: 200, name: 'Garage' },
      { modId: 999, name: 'Radio Addon', notes: 'Optional - only for music' },
    ],
  },
  {
    id: 200,
    name: 'Garage',
    files: [
      { id: 21, name: 'Garage Core', version: '1.0.4', cat: 'MAIN', zip: { 'archive/pc/mod/garage_core.archive': 'core' } },
      { id: 22, name: 'Garage Service Ammo', version: '1.0.0', cat: 'MAIN', zip: { 'archive/pc/mod/garage_ammo.archive': 'ammo' } },
      { id: 20, name: 'Garage Core', version: '1.0.3', cat: 'OLD_VERSION', zip: { 'archive/pc/mod/garage_core.archive': 'core-old' } },
    ],
  },
  { id: 300, name: 'Messy Mod', files: [{ id: 31, name: 'Messy', version: '1', cat: 'MAIN', zip: { 'archive/pc/mod/messy.archive': 'm', 'weird.bin': '?' } }] },
  { id: 400, name: 'Solo Lib', files: [{ id: 41, name: 'Solo Lib', version: '3.1', cat: 'MAIN', zip: { 'archive/pc/mod/solo.archive': 'solo' } }] },
]

async function fakeNexus(base: string) {
  const zips = new Map<number, Buffer>()
  for (const m of MODS) for (const f of m.files) zips.set(f.id, await fs.readFile(await makeZip(base, `z${f.id}.zip`, f.zip)))
  const calls: string[] = []
  const graph: string[] = []
  const posts: string[] = []
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } })
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    if (url === 'https://api.nexusmods.com/v2/graphql') {
      const q = JSON.parse(String(init?.body)).query as string
      graph.push(q)
      const ids = [...q.matchAll(/modId: (\d+)\}/g)].map((x) => Number(x[1]))
      if (q.includes('collectionRevision')) {
        const files = [MODS[1].files[0], MODS[1].files[1], MODS[2].files[0]].map((f) => {
          const mod = MODS.find((m) => m.files.includes(f))!
          return {
            fileId: f.id,
            optional: false,
            file: { fileId: f.id, name: f.name, version: f.version, modId: mod.id, sizeInBytes: String(zips.get(f.id)!.length), category: f.cat, mod: { modId: mod.id, name: mod.name, author: 'Ann', pictureUrl: null, adultContent: false, status: 'published' } },
          }
        })
        return json({ data: { collectionRevision: { revisionNumber: 7, adultContent: false, collection: { name: 'Test Pack', slug: 'tpack1', summary: 'S', user: { name: 'Ann' }, tileImage: null }, modFiles: files } } })
      }
      if (q.includes('modRequirements')) {
        const nodes = MODS.filter((m) => ids.includes(m.id)).map((m) => ({
          modId: m.id,
          modRequirements: { nexusRequirements: { nodes: (m.requires ?? []).map((r) => ({ modId: String(r.modId), modName: r.name, notes: r.notes ?? '', externalRequirement: false, gameId: '3333' })) } },
        }))
        // Wie bei Nexus: ein versteckter Mod im Batch liefert einen Fehler, die übrigen Daten kommen trotzdem
        return json({ data: { legacyMods: { nodes } }, errors: [{ message: 'Mod 777 is hidden' }] })
      }
      if (q.includes('pictureUrl')) {
        const nodes = MODS.filter((m) => ids.includes(m.id)).map((m) => ({ modId: m.id, name: m.name, author: 'Ann', pictureUrl: null, adultContent: false, status: 'published' }))
        return json({ data: { legacyMods: { nodes } } })
      }
      return json({ errors: [{ message: 'unknown query' }] })
    }
    const h = (init?.headers ?? {}) as Record<string, string>
    if (url.startsWith('https://api.nexusmods.com/v1') && h.apikey !== KEY) return new Response('{"message":"bad key"}', { status: 401 })
    if (url.endsWith('/users/validate.json')) return json({ user_id: 9, name: 'Tester', is_premium: true, is_supporter: false })
    if (url.endsWith('/user/endorsements.json'))
      return json([
        { mod_id: 200, domain_name: 'cyberpunk2077', status: 'Endorsed' },
        { mod_id: 400, domain_name: 'cyberpunk2077', status: 'Abstained' },
        { mod_id: 5, domain_name: 'skyrimspecialedition', status: 'Endorsed' },
      ])
    const en = url.match(/\/mods\/(\d+)\/(endorse|abstain)\.json$/)
    if (en) {
      posts.push(`${init?.method} ${en[1]} ${en[2]} ${String(init?.body)}`)
      return json({ message: 'ok', status: en[2] === 'endorse' ? 'Endorsed' : 'Abstained' })
    }
    const mm = url.match(/\/mods\/(\d+)\.json$/)
    if (mm) {
      const m = MODS.find((x) => x.id === Number(mm[1]))!
      return json({ mod_id: m.id, name: m.name, version: m.files[0].version, author: 'Ann', summary: '' })
    }
    const fm = url.match(/\/mods\/(\d+)\/files\.json$/)
    if (fm) {
      const m = MODS.find((x) => x.id === Number(fm[1]))!
      const files: NexusFiles = {
        files: m.files.map((f, i) => ({
          file_id: f.id,
          name: f.name,
          version: f.version,
          category_name: f.cat,
          file_name: `${f.name}-${m.id}-${f.version.replace(/\./g, '-')}-${1700000000 + f.id}.zip`,
          uploaded_timestamp: i + 1,
          size_in_bytes: zips.get(f.id)!.length,
        })),
        file_updates: [],
      }
      return json(files)
    }
    const dl = url.match(/files\/(\d+)\/download_link\.json/)
    if (dl) return json([{ name: 'CDN', short_name: 'CDN', URI: `https://cdn.test/file${dl[1]}.zip` }])
    const cdn = url.match(/^https:\/\/cdn\.test\/file(\d+)\.zip$/)
    if (cdn) {
      const z = zips.get(Number(cdn[1]))!
      return new Response(new Uint8Array(z), { headers: { 'content-length': String(z.length) } })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { impl, calls, graph, posts }
}

async function setup(opts: { running?: { on: boolean } } = {}) {
  const base = await tmpDir('shards')
  const game = path.join(base, 'game')
  const user = path.join(base, 'user')
  // CET liegt schon im Spielordner (von Hand installiert): zählt als Requirement erfüllt
  await writeTree(game, { 'bin/x64/Cyberpunk2077.exe': 'MZ', 'bin/x64/plugins/cyber_engine_tweaks.asi': 'cet', 'archive/pc/mod/.keep': '' })
  await writeTree(user, { 'settings.json': JSON.stringify({ gameRoot: game, dataRoot: path.join(base, 'data') }) })
  const fake = await fakeNexus(base)
  const events: { event: string; payload: unknown }[] = []
  const opened: string[] = []
  const core = new Core({
    userData: user,
    openUrl: async (u) => void opened.push(u),
    emit: (event, payload) => events.push({ event, payload }),
    appVersion: '0.0.0-test',
    crypto: FAKE_CRYPTO,
    protocol: { status: () => ({ state: 'ours', other: null }), set: () => true },
    fetchImpl: fake.impl,
    autoDelayMs: 0,
    gameRunning: async () => opts.running?.on ?? false,
  })
  await core.init()
  core.pendingImports()
  await core.nexus.setKey(KEY)
  const g = (rel: string) => path.join(game, ...rel.split('/'))
  const until = async (what: string, ok: () => boolean | Promise<boolean>) => {
    for (let i = 0; i < 400; i++) {
      if (await ok()) return
      await new Promise((r) => setTimeout(r, 15))
    }
    throw new Error(`Zeitüberschreitung: ${what}`)
  }
  const notices = () => events.filter((e) => e.event === 'notify').map((e) => e.payload as Notice)
  const imports = () => events.filter((e) => e.event === 'imports').flatMap((e) => e.payload as ImportPreview[])
  return { core, g, fake, events, opened, until, notices, imports, base }
}

describe('Collections (Premium)', () => {
  it('lädt alles Ausgewählte, installiert Klares ohne Dialog, einmal eingespielt; Unklares öffnet den Dialog', async () => {
    const { core, g, until, notices, imports, fake } = await setup()
    const plan = await core.loadCollection('https://www.nexusmods.com/games/cyberpunk2077/collections/tpack1')
    expect(plan.title).toBe('Test Pack')
    expect(plan.revision).toBe(7)
    expect(plan.entries.map((e) => e.state)).toEqual(['missing', 'missing', 'missing'])
    expect(fake.graph.some((q) => q.includes('collectionRevision'))).toBe(true)

    const run = await core.planDownload(plan.id, plan.entries.map((e) => e.key))
    expect(run.queued).toHaveLength(3)
    expect(run.queued.every((d) => d.auto && d.origin?.title === 'Test Pack')).toBe(true)

    await until('zwei Auto-Installs', () => core.mods.list().length === 2)
    await until('Dialog für den unklaren Mod', () => imports().length === 1)
    await core.idle()
    expect(imports()[0].unknown).toEqual(['weird.bin'])
    // Beide Garage-Teile sind eigene Mods (Multi-File), keiner ersetzt den anderen
    const garage = core.mods.list().filter((m) => m.source.nexusModId === 200)
    expect(garage.map((m) => m.source.nexusFile).sort()).toEqual(['Garage Core', 'Garage Service Ammo'])
    expect(garage.every((m) => m.origin?.kind === 'collection' && m.origin.title === 'Test Pack')).toBe(true)
    expect(await fs.readFile(g('archive/pc/mod/garage_core.archive'), 'utf8')).toBe('core')
    expect(await fs.readFile(g('archive/pc/mod/garage_ammo.archive'), 'utf8')).toBe('ammo')
    expect(notices().some((n) => n.title === 'AUTO-INSTALL' && /2 Mods installiert/.test(n.body ?? ''))).toBe(true)

    const after = core.planView(plan.id)!
    expect(after.entries.filter((e) => e.state === 'installed')).toHaveLength(2)
    // Noch einmal laden: nichts mehr zu tun für die installierten
    expect((await core.planDownload(plan.id, after.entries.filter((e) => e.state === 'installed').map((e) => e.key))).queued).toHaveLength(0)
  })

  it('nxm-Knopf einer Collection öffnet den Plan', async () => {
    const { core, events } = await setup()
    await core.handleNxm('nxm://cyberpunk2077/collections/tpack1/revisions/7')
    const ev = events.find((e) => e.event === 'plan')
    expect((ev?.payload as { title: string }).title).toBe('Test Pack')
  })
})

describe('Collections ohne Premium', () => {
  it('öffnet die Dateiseiten in Portionen; der nxm-Klick von dort installiert sich wie geplant', async () => {
    const { core, opened, until } = await setup()
    core.nexus.user!.premium = false
    const plan = await core.loadCollection('tpack1')
    const run = await core.planDownload(plan.id, plan.entries.map((e) => e.key))
    expect(run.queued).toHaveLength(0)
    expect(run.opened).toBe(3)
    expect(opened[0]).toBe('https://www.nexusmods.com/cyberpunk2077/mods/200?tab=files&file_id=21&nmm=1')
    // Schon geöffnete nicht noch einmal
    expect((await core.planDownload(plan.id, plan.entries.map((e) => e.key))).opened).toBe(0)
    expect(core.planView(plan.id)!.entries[0].opened).toBe(true)

    // Der Klick auf "Slow download" → nxm mit Freigabe
    await core.handleNxm('nxm://cyberpunk2077/mods/200/files/22?key=K&expires=9999999999&user_id=9')
    await until('Auto-Install aus dem nxm-Klick', () => core.mods.list().length === 1)
    await core.idle()
    expect(core.mods.list()[0]).toMatchObject({ origin: { kind: 'collection', title: 'Test Pack' }, source: { nexusFileId: 22 } })
  })
})

describe('Requirements', () => {
  it('liest sie von Nexus, gleicht ab und holt fehlende als Auto-Install', async () => {
    const { core, until, fake } = await setup()
    const reqs = await core.requirements(100)
    expect(reqs.map((r) => [r.modId, r.state, r.optional])).toEqual([
      [107, 'ok', false], // CET liegt im Spielordner
      [200, 'missing', false],
      [999, 'missing', true],
    ])
    // Zweiter Aufruf aus dem Cache, ohne Netz
    const before = fake.graph.length
    await core.requirements(100)
    expect(fake.graph.length).toBe(before)

    // Neon installieren: Inventar zeigt Garage als fehlend (nicht das optionale Radio-Addon)
    await core.nexus.downloadFile(100, 2, undefined, { auto: true })
    await until('Neon installiert', () => core.mods.list().length === 1)
    await core.idle()
    expect((await core.inventory()).missingNexus.map((m) => m.name)).toEqual(['Garage'])

    // Garage hat zwei verschiedene Hauptdateien: nicht raten, sondern die Nexus-Seite öffnen
    const run = await core.fetchRequirements([{ modId: 200, name: 'Garage' }, { modId: 400, name: 'Solo Lib' }], 'Neon Night Lights')
    expect(run.queued).toHaveLength(1)
    expect(run.opened).toBe(1)
    await until('Solo Lib installiert', () => core.mods.list().some((m) => m.source.nexusModId === 400))
    await core.idle()
    expect(core.mods.list().find((m) => m.source.nexusModId === 400)?.origin).toEqual({ kind: 'requirement', title: 'Neon Night Lights' })
  })
})

describe('Mehrfach-Aktionen, Teilen, Aufräumen', () => {
  async function withThree() {
    const s = await setup()
    for (const [mod, file] of [
      [200, 21],
      [200, 22],
      [400, 41],
    ]) {
      await s.core.nexus.downloadFile(mod, file, undefined, { auto: true })
    }
    await s.until('drei installiert', () => s.core.mods.list().length === 3)
    await s.core.idle()
    return s
  }

  it('schaltet und entfernt mehrere Mods mit einem Einspielen', async () => {
    const { core, g } = await withThree()
    const ids = core.mods.list().map((m) => m.id)
    const off = await core.setEnabledMany(ids.slice(0, 2), false)
    expect(ids.slice(0, 2).every((id) => !off.profile.enabled[id])).toBe(true)
    expect(off.profile.enabled[ids[2]]).toBe(true)
    const on = await core.setEnabledMany(ids, true)
    expect(ids.every((id) => on.profile.enabled[id])).toBe(true)
    const left = await core.removeMany(ids.slice(0, 2))
    expect(left.mods.map((m) => m.id)).toEqual([ids[2]])
    expect(await exists(g('archive/pc/mod/garage_core.archive'))).toBe(false)
    expect(await exists(g('archive/pc/mod/garage_ammo.archive'))).toBe(false)
    expect(await fs.readFile(g('archive/pc/mod/solo.archive'), 'utf8')).toBe('solo')
  })

  it('Shard: teilen, beim Empfänger öffnen, Reihenfolge übernehmen', async () => {
    const { core } = await withThree()
    const mods = core.mods.list()
    const solo = mods.find((m) => m.source.nexusModId === 400)!
    // Absender: Solo Lib ganz oben und aus
    await core.setEnabledMany([solo.id], false)
    core.profiles.move(solo.id, 0)
    const ex = core.shareExport({ title: 'Mein Build', onlyActive: false })
    expect(ex.nexus).toBe(3)
    expect(ex.text).toContain('/mods/400')

    const plan = await core.readShard(ex.code)
    expect(plan.kind).toBe('shard')
    expect(plan.entries.every((e) => e.state === 'installed')).toBe(true)
    expect(plan.entries[0]).toMatchObject({ modId: 400, enabled: false, optional: true })

    // Empfänger hat eine andere Reihenfolge und alles an
    core.profiles.move(solo.id, 2)
    await core.setEnabledMany([solo.id], true)
    const inv = await core.planApplyOrder(plan.id)
    expect(inv.profile.order[0]).toBe(solo.id)
    expect(inv.profile.enabled[solo.id]).toBe(false)
  })

  it('räumt nur Archive weg, die zu keinem Mod mehr gehören', async () => {
    const { core } = await withThree()
    const before = await core.downloadsUsage()
    expect(before.files).toBe(3)
    expect(before.unused).toBe(0)
    const solo = core.mods.list().find((m) => m.source.nexusModId === 400)!
    await core.removeMany([solo.id])
    // Fertige Downloads in der Liste zählen noch als "in Gebrauch" (ihr Import könnte gerade laufen)
    expect((await core.downloadsUsage()).unused).toBe(0)
    core.nexus.queue.clearFinished()
    expect((await core.downloadsUsage()).unused).toBe(1)
    const after = await core.cleanDownloads()
    expect(after.files).toBe(2)
    expect(after.unused).toBe(0)
    expect(await exists(path.join(core.mods.downloadsDir, solo.source.archive))).toBe(false)
  })
})

describe('Schnell-Installieren', () => {
  it('aus: Download öffnet den Dialog; an: installiert sich ohne Dialog', async () => {
    const { core, until, imports } = await setup()
    await core.nexus.downloadFile(400, 41)
    await until('Dialog', () => imports().length === 1)
    expect(core.mods.list()).toHaveLength(0)
    await core.cancelImport(imports()[0].token)
    await core.settings.patch({ quickInstall: true })
    await core.nexus.downloadFile(200, 21)
    await until('Auto-Install', () => core.mods.list().length === 1)
    await core.idle()
    expect(imports()).toHaveLength(1)
  })
})

describe('Review-Fixes', () => {
  it('kein stilles Downgrade: ältere Datei aus einem Shard geht nur mit Dialog', async () => {
    const { core, until, imports } = await setup()
    await core.nexus.downloadFile(200, 21, undefined, { auto: true })
    await until('Garage Core 1.0.4', () => core.mods.list().length === 1)
    await core.idle()
    const code = encodeShard({
      title: 'Alter Build',
      patch: '2.3',
      created: '2026-10-01T00:00:00.000Z',
      mods: [{ modId: 200, fileId: 20, name: 'Garage', version: '1.0.3', title: 'Garage Core', on: true }],
      local: [],
    })
    const plan = await core.readShard(code)
    expect(plan.entries[0]).toMatchObject({ state: 'older', installedVersion: '1.0.4' })
    const run = await core.planDownload(plan.id, [plan.entries[0].key])
    expect(run.queued[0].auto).toBe(false)
    await until('Dialog statt Auto-Install', () => imports().length === 1)
    expect(core.mods.list().map((m) => m.version)).toEqual(['1.0.4'])
  })

  it('Update bei laufendem Spiel: alter Mod bleibt im Staging, bis eingespielt ist', async () => {
    const running = { on: false }
    const { core, g, until, notices } = await setup({ running })
    await core.nexus.downloadFile(200, 20, undefined, { auto: true })
    await until('Garage Core 1.0.3', () => core.mods.list().length === 1)
    await core.idle()
    const old = core.mods.list()[0]
    expect(await fs.readFile(g('archive/pc/mod/garage_core.archive'), 'utf8')).toBe('core-old')

    running.on = true
    await core.nexus.downloadFile(200, 21, old.id, { auto: true })
    await until('Update gestaged', () => core.mods.list().some((m) => m.source.nexusFileId === 21))
    await until('Warnung', () => notices().some((n) => n.title === 'AUTO-INSTALL' && n.tone === 'warn'))
    // Alter Mod ist aus der Liste, sein Ordner aber noch da (die Dateien hängen im laufenden Spiel)
    expect(core.mods.mods.has(old.id)).toBe(false)
    expect(await exists(path.join(core.dataRoot, 'mods', old.id, 'mod.removed.json'))).toBe(true)
    expect(await fs.readFile(g('archive/pc/mod/garage_core.archive'), 'utf8')).toBe('core-old')

    running.on = false
    await core.idle()
    expect(await fs.readFile(g('archive/pc/mod/garage_core.archive'), 'utf8')).toBe('core')
    expect(await exists(path.join(core.dataRoot, 'mods', old.id))).toBe(false)
    // Nur einmal gewarnt, dann Erfolg gemeldet
    expect(notices().filter((n) => n.title === 'AUTO-INSTALL' && n.tone === 'warn')).toHaveLength(1)
    expect(notices().some((n) => n.title === 'AUTO-INSTALL' && n.tone === 'ok')).toBe(true)
  })

  it('Geschlossener Plan: ein später nxm-Klick installiert nicht mehr automatisch', async () => {
    const { core, until, imports } = await setup()
    core.nexus.user!.premium = false
    const plan = await core.loadCollection('tpack1')
    await core.planDownload(plan.id, [plan.entries[0].key])
    core.closePlan(plan.id)
    const item = await core.nexus.handleNxm('nxm://cyberpunk2077/mods/200/files/21?key=K&expires=9999999999')
    expect(item.auto).toBeUndefined()
    await until('Dialog', () => imports().length === 1)
    expect(core.mods.list()).toHaveLength(0)
  })

  it('Shard-Dateien nur von lokalen Laufwerken, kaputte .rdshard als Meldung', async () => {
    const { core, base, notices } = await setup()
    await expect(core.readShardFile('\\\\server\\share\\x.rdshard')).rejects.toThrow(/Shard/)
    const bad = path.join(base, 'kaputt.rdshard')
    await fs.writeFile(bad, 'nix')
    await core.openShardPath(bad)
    expect(notices().some((n) => n.title === 'SHARD' && n.tone === 'alert')).toBe(true)
  })

  it('Endorsements: nur Cyberpunk-Mods, empfehlen schickt die Version mit', async () => {
    const { core, fake } = await setup()
    expect(await core.nexus.endorsedMods()).toEqual([200])
    expect(await core.nexus.endorse(400, '3.1', true)).toEqual(expect.arrayContaining([200, 400]))
    expect(await core.nexus.endorse(200, '1.0.4', false)).toEqual([400])
    expect(fake.posts).toEqual(['POST 400 endorse version=3.1', 'POST 200 abstain version=1.0.4'])
  })

  it('Mehrere an/aus ohne Änderung spielt nichts ein (geht auch bei laufendem Spiel)', async () => {
    const running = { on: true }
    const { core } = await setup({ running })
    await expect(core.setEnabledMany([], true)).resolves.toBeTruthy()
  })
})
