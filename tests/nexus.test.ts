import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import { parseArchiveName } from '../src/main/install/analyze'
import { KeyStore, type Crypto } from '../src/main/nexus/keystore'
import { parseNxm, redactNxm } from '../src/main/nexus/nxm'
import { compareVersions, computeUpdate, predecessors, thumbnailOf, type NexusFiles } from '../src/main/nexus/updates'
import type { ImportPreview, NxmState } from '../src/shared/types'
import { exists, makeZip, tmpDir, writeTree } from './helpers'

// Spielzeug-Verschlüsselung für Tests (umgedrehter Text); echt ist Electron safeStorage.
const FAKE_CRYPTO: Crypto = {
  available: () => true,
  encrypt: (t) => Buffer.from([...t].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
}

describe('nxm-Links', () => {
  it('liest Mod, Datei und Freigabe', () => {
    expect(parseNxm('nxm://cyberpunk2077/mods/107/files/167620?key=abc&expires=1792999999&user_id=5')).toEqual({
      game: 'cyberpunk2077',
      modId: 107,
      fileId: 167620,
      key: 'abc',
      expires: 1792999999,
      userId: 5,
    })
    expect(parseNxm('nxm://Cyberpunk2077/mods/1/files/2')?.game).toBe('cyberpunk2077')
  })
  it('lehnt Fremdes ab', () => {
    expect(parseNxm('https://www.nexusmods.com/cyberpunk2077/mods/107')).toBeNull()
    expect(parseNxm('nxm://cyberpunk2077/collections/abc/revisions/3')).toBeNull()
    expect(parseNxm('kaputt')).toBeNull()
  })
  it('schwärzt die geheimen Teile', () => {
    expect(redactNxm('nxm://cyberpunk2077/mods/1/files/2?key=SECRET&expires=123&user_id=9')).toBe('nxm://cyberpunk2077/mods/1/files/2?key=…&expires=…&user_id=…')
  })
})

describe('Versionen und Updates', () => {
  it('vergleicht Versionen', () => {
    expect(compareVersions('1.38.0', '1.37.1')).toBe(1)
    expect(compareVersions('v2.0', '2.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.10')).toBe(-1)
    expect(compareVersions('1.2a', '1.2b')).toBe(-1)
    expect(compareVersions('?', '1.0')).toBeNull()
  })

  const files: NexusFiles = {
    files: [
      { file_id: 1, name: 'Main', version: '1.0', category_name: 'OLD_VERSION', file_name: 'a-1.zip', uploaded_timestamp: 1 },
      { file_id: 2, name: 'Main', version: '2.0', category_name: 'MAIN', file_name: 'a-2.zip', uploaded_timestamp: 2 },
      { file_id: 3, name: 'Addon', version: '1.0', category_name: 'OPTIONAL', file_name: 'addon.zip', uploaded_timestamp: 3 },
    ],
    file_updates: [{ old_file_id: 1, new_file_id: 2 }],
  }

  it('folgt der Update-Kette', () => {
    expect(computeUpdate({ version: '1.0', fileId: 1 }, '2.0', files)).toEqual({ hasUpdate: true, latest: '2.0', latestFileId: 2, latestFileName: 'a-2.zip' })
    expect(computeUpdate({ version: '2.0', fileId: 2 }, '2.0', files).hasUpdate).toBe(false)
    // Optionale Datei, selbst noch aktuell: die neue Mod-Version betrifft eine andere Datei, kein Update
    expect(computeUpdate({ version: '1.0', fileId: 3 }, '2.0', files).hasUpdate).toBe(false)
  })
  it('ohne Datei-ID zählt die Mod-Version', () => {
    expect(computeUpdate({ version: '1.0' }, '2.0', files)).toMatchObject({ hasUpdate: true, latestFileId: 2 })
    expect(computeUpdate({ version: '2.0' }, '2.0', files).hasUpdate).toBe(false)
    expect(computeUpdate({ version: '?' }, '2.0', files).hasUpdate).toBe(false)
  })
  it('kennt die Vorgänger einer Datei', () => {
    expect(predecessors(files, 2)).toEqual([1])
    expect(predecessors(files, 3)).toEqual([])
  })
  it('macht aus dem Bild ein Vorschaubild', () => {
    expect(thumbnailOf('https://staticdelivery.nexusmods.com/mods/3333/images/107/107-1-2.png')).toBe(
      'https://staticdelivery.nexusmods.com/mods/3333/images/thumbnails/107/107-1-2.png',
    )
  })
  it('liest das neue Nexus-Dateinamensschema', () => {
    expect(parseArchiveName('CET 1.38.0 - Game version 2.5 107 1.38.0 2026-10-22T12-57Z Q6xF6lly7.zip')).toEqual({
      name: 'CET 1.38.0 - Game version 2.5',
      nexusModId: 107,
      version: '1.38.0',
    })
  })
})

describe('KeyStore', () => {
  it('speichert nur verschlüsselt', async () => {
    const dir = await tmpDir('key')
    const ks = new KeyStore(path.join(dir, 'k.bin'), FAKE_CRYPTO)
    await ks.save('MEIN-KEY-123')
    expect((await fs.readFile(path.join(dir, 'k.bin'), 'utf8')).includes('MEIN-KEY-123')).toBe(false)
    const again = new KeyStore(path.join(dir, 'k.bin'), FAKE_CRYPTO)
    expect(await again.load()).toBe('MEIN-KEY-123')
    await again.clear()
    expect(await exists(path.join(dir, 'k.bin'))).toBe(false)
  })
  it('verweigert ohne Verschlüsselung', async () => {
    const dir = await tmpDir('key')
    const ks = new KeyStore(path.join(dir, 'k.bin'), { ...FAKE_CRYPTO, available: () => false })
    await expect(ks.save('X')).rejects.toThrow(/Verschlüsselung/)
  })
})

/** Falsche Nexus-API + CDN. Zählt Aufrufe und merkt sich, ob der Key mitgeschickt wurde. */
function fakeNexus(zips: Record<number, Buffer>) {
  const calls: string[] = []
  const files: NexusFiles = {
    files: [
      { file_id: 1, name: 'Neon Main', version: '1.0', category_name: 'OLD_VERSION', file_name: 'Neon-100-1-0-1.zip', uploaded_timestamp: 1, size_in_bytes: zips[1]?.length },
      { file_id: 2, name: 'Neon Main', version: '2.0', category_name: 'MAIN', file_name: 'Neon-100-2-0-2.zip', uploaded_timestamp: 2, size_in_bytes: zips[2]?.length },
      { file_id: 3, name: 'Neon Addon', version: '1.0', category_name: 'OPTIONAL', file_name: 'Neon Addon-100-1-0-3.zip', uploaded_timestamp: 3, size_in_bytes: zips[3]?.length },
    ],
    file_updates: [{ old_file_id: 1, new_file_id: 2 }],
  }
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json', 'x-rl-hourly-remaining': '1999', 'x-rl-daily-remaining': '19999' } })
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    const h = (init?.headers ?? {}) as Record<string, string>
    if (url.startsWith('https://api.nexusmods.com') && h.apikey !== 'TEST-KEY-1234567890-abcdef') return new Response('{"message":"Please provide a valid API Key"}', { status: 401 })
    if (url.endsWith('/users/validate.json')) return json({ user_id: 9, name: 'Tester', is_premium: true, is_supporter: false })
    if (url.endsWith('/mods/100.json'))
      return json({ mod_id: 100, name: 'Neon Night Lights', version: '2.0', author: 'Ann', summary: 'Lichter', picture_url: 'https://staticdelivery.nexusmods.com/mods/3333/images/100/100-1.png' })
    if (url.endsWith('/mods/100/files.json')) return json(files)
    const dl = url.match(/files\/(\d+)\/download_link\.json/)
    if (dl) return json([{ name: 'CDN', short_name: 'CDN', URI: `https://cdn.test/file${dl[1]}.zip` }])
    const cdn = url.match(/^https:\/\/cdn\.test\/file(\d+)\.zip$/)
    if (cdn) return new Response(new Uint8Array(zips[Number(cdn[1])]), { headers: { 'content-length': String(zips[Number(cdn[1])].length) } })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { impl, calls }
}

async function nexusSetup() {
  const base = await tmpDir('nexus')
  const game = path.join(base, 'game')
  const user = path.join(base, 'user')
  await writeTree(game, { 'bin/x64/Cyberpunk2077.exe': 'MZ', 'archive/pc/mod/.keep': '', 'r6/cache/final.redscripts': 'v' })
  await writeTree(user, { 'settings.json': JSON.stringify({ gameRoot: game, dataRoot: path.join(base, 'data') }) })
  const zips = {
    1: await fs.readFile(await makeZip(base, 'n1.zip', { 'archive/pc/mod/neon.archive': 'v1' })),
    2: await fs.readFile(await makeZip(base, 'n2.zip', { 'archive/pc/mod/neon.archive': 'v2' })),
    3: await fs.readFile(await makeZip(base, 'n3.zip', { 'archive/pc/mod/neon_addon.archive': 'addon' })),
  }
  const fake = fakeNexus(zips)
  let nxm: NxmState = 'none'
  const events: { event: string; payload: unknown }[] = []
  const core = new Core({
    userData: user,
    openUrl: async () => undefined,
    emit: (event, payload) => events.push({ event, payload }),
    appVersion: '0.0.0-test',
    crypto: FAKE_CRYPTO,
    protocol: { status: () => ({ state: nxm, other: null }), set: (on) => ((nxm = on ? 'ours' : 'none'), true) },
    fetchImpl: fake.impl,
  })
  await core.init()
  core.pendingImports() // Oberfläche "bereit": Imports kommen als Ereignis
  const g = (rel: string) => path.join(game, ...rel.split('/'))
  const nextImport = async (): Promise<ImportPreview> => {
    for (let i = 0; i < 200; i++) {
      const hit = events.findIndex((e) => e.event === 'imports')
      if (hit >= 0) return (events.splice(hit, 1)[0].payload as ImportPreview[])[0]
      const fail = events.find((e) => e.event === 'notify' && (e.payload as { tone: string }).tone === 'alert')
      if (fail) throw new Error(JSON.stringify(fail.payload))
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('kein Import')
  }
  return { core, g, fake, nextImport, nxmState: () => nxm }
}

describe('Nexus-Durchlauf (API simuliert)', () => {
  it('Key prüfen, nxm registrieren, per Link laden, installieren, Update erkennen und ersetzen', async () => {
    const { core, g, fake, nextImport, nxmState } = await nexusSetup()

    await expect(core.nexus.setKey('FALSCHER-KEY-1234567890')).rejects.toThrow(/ungültig/)
    expect(core.nexusStatus().hasKey).toBe(false)
    const st = await core.nexus.setKey('TEST-KEY-1234567890-abcdef')
    expect(st.user).toEqual({ name: 'Tester', premium: true, supporter: false })
    expect(st.nxm).toBe('ours')
    expect(nxmState()).toBe('ours')
    expect(st.rate).toEqual({ hourly: 1999, daily: 19999 })

    // Alte Version 1.0 per nxm-Link (mit Freigabe wie von der Website)
    await core.handleNxm('nxm://cyberpunk2077/mods/100/files/1?key=K&expires=1999999999&user_id=9')
    const p1 = await nextImport()
    expect(p1.name).toBe('Neon Night Lights')
    expect(p1.version).toBe('1.0')
    expect(p1.nexus?.author).toBe('Ann')
    expect(fake.calls.some((c) => c.includes('download_link.json?key=K&expires=1999999999'))).toBe(true)
    const out1 = await core.commitImport({ token: p1.token, unknown: 'skip' })
    if (!out1.ok) throw new Error(out1.error)
    expect(out1.mod.source).toMatchObject({ kind: 'nexus', nexusModId: 100, nexusFileId: 1, nexusCategory: 'OLD_VERSION' })
    expect(out1.mod.nexus?.picture).toContain('/thumbnails/100/')
    expect(await fs.readFile(g('archive/pc/mod/neon.archive'), 'utf8')).toBe('v1')

    // Update-Check findet 2.0 über die Update-Kette
    const ups = await core.checkUpdates()
    expect(ups[out1.mod.id]).toMatchObject({ hasUpdate: true, latest: '2.0', latestFileId: 2 })
    expect((await core.inventory()).updates[out1.mod.id].hasUpdate).toBe(true)

    // Optionales Addon desselben Mods (anderer Dateititel): eigene Datei, nichts zum Ersetzen angeboten
    await core.nexus.downloadFile(100, 3)
    const p3 = await nextImport()
    expect(p3.replaces).toBeNull()
    expect(p3.replaceDefault).toBe(false)
    const out3 = await core.commitImport({ token: p3.token, unknown: 'skip', replace: false })
    if (!out3.ok) throw new Error(out3.error)

    // Update aus der App (Premium) → ersetzt 1.0 an gleicher Stelle
    await core.downloadUpdate(out1.mod.id)
    const p2 = await nextImport()
    expect(p2.replaces).toBe(out1.mod.id)
    expect(p2.replaceDefault).toBe(true)
    const out2 = await core.commitImport({ token: p2.token, unknown: 'skip', replace: true })
    if (!out2.ok) throw new Error(out2.error)
    expect(await fs.readFile(g('archive/pc/mod/neon.archive'), 'utf8')).toBe('v2')
    expect(await fs.readFile(g('archive/pc/mod/neon_addon.archive'), 'utf8')).toBe('addon')
    expect(core.mods.mods.has(out1.mod.id)).toBe(false)
    expect((await core.inventory()).updates[out1.mod.id]).toBeUndefined()

    // Download-Liste: drei fertige Downloads, Archive liegen in downloads/
    const items = core.nexus.queue.items
    expect(items.map((i) => i.state)).toEqual(['done', 'done', 'done'])
    expect(await exists(path.join(core.dataRoot, 'downloads', 'Neon-100-2-0-2.zip'))).toBe(true)

    // Key wieder weg
    expect((await core.nexus.clearKey()).hasKey).toBe(false)
  })

  it('fremde Spiele und Links ohne Freigabe werden abgelehnt', async () => {
    const { core } = await nexusSetup()
    await core.nexus.setKey('TEST-KEY-1234567890-abcdef')
    await expect(core.nexus.handleNxm('nxm://skyrimspecialedition/mods/1/files/2?key=a&expires=1')).rejects.toThrow(/skyrimspecialedition/)
    core.nexus.user!.premium = false
    await expect(core.nexus.handleNxm('nxm://cyberpunk2077/mods/100/files/2')).rejects.toThrow(/Premium/)
  })
})
