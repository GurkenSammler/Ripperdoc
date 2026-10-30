import { deflateRawSync } from 'node:zlib'
import { normTitle } from '../src/main/mods/identity'
import { parseCollectionRef } from '../src/main/nexus/nxm'
import { isOptionalNote } from '../src/main/nexus/requirements'
import { computeUpdate, pickMainFile, type NexusFiles } from '../src/main/nexus/updates'
import { collectionPlan, decodeShard, encodeShard, resolvePlan, shardFile, shardFromInventory, shardPlan, shardText } from '../src/main/plans'
import type { DownloadItem, ModRecord, Profile } from '../src/shared/types'

const rec = (id: string, over: Partial<ModRecord['source']> & { name?: string; version?: string } = {}): ModRecord => ({
  id,
  name: over.name ?? id,
  version: over.version ?? '1.0',
  source: { kind: 'nexus', archive: `${id}.zip`, ...over },
  installedAt: '2026-10-30T10:00:00.000Z',
  types: ['archive'],
  files: [],
  docs: [],
  provides: [],
  requires: [],
  skipped: [],
  rule: 'test',
})

describe('Collection-Links', () => {
  it('versteht Website, nxm-Knopf und Kurznamen', () => {
    expect(parseCollectionRef('https://www.nexusmods.com/games/cyberpunk2077/collections/iszwwe')).toEqual({ game: 'cyberpunk2077', slug: 'iszwwe', revision: null })
    expect(parseCollectionRef('https://www.nexusmods.com/games/cyberpunk2077/collections/iszwwe/revisions/483?tab=mods')).toEqual({
      game: 'cyberpunk2077',
      slug: 'iszwwe',
      revision: 483,
    })
    expect(parseCollectionRef('https://next.nexusmods.com/cyberpunk2077/collections/devnx1')?.slug).toBe('devnx1')
    expect(parseCollectionRef('nxm://cyberpunk2077/collections/iszwwe/revisions/12')).toEqual({ game: 'cyberpunk2077', slug: 'iszwwe', revision: 12 })
    expect(parseCollectionRef('  IsZwWe ')).toEqual({ game: 'cyberpunk2077', slug: 'iszwwe', revision: null })
  })
  it('erkennt fremde Spiele und Unsinn', () => {
    expect(parseCollectionRef('https://www.nexusmods.com/games/skyrimspecialedition/collections/abcdef')?.game).toBe('skyrimspecialedition')
    expect(parseCollectionRef('https://example.com/cyberpunk2077/collections/iszwwe')).toBeNull()
    expect(parseCollectionRef('https://www.nexusmods.com/cyberpunk2077/mods/107')).toBeNull()
    expect(parseCollectionRef('nicht mal ein link')).toBeNull()
  })
})

describe('Dateititel', () => {
  it('Versionsnummern im Titel zählen nicht, Teilnummern schon', () => {
    expect(normTitle('CET 1.38.0 - Game version 2.5')).toBe(normTitle('CET 1.37.1 - Game version 2.31'))
    expect(normTitle('Garage - Service_Ammo')).toBe(normTitle('garage service ammo'))
    expect(normTitle('Vehicle Pack v2')).toBe(normTitle('Vehicle Pack v3'))
    expect(normTitle('Part 1')).not.toBe(normTitle('Part 2'))
    expect(normTitle('Textures 2K')).not.toBe(normTitle('Textures 4K'))
    expect(normTitle('1.0.4')).not.toBe('')
  })
})

describe('Requirements-Notizen', () => {
  it('erkennt optionale Einträge', () => {
    expect(isOptionalNote('Optional - Install to get NFSU2 music')).toBe(true)
    expect(isOptionalNote('Optional, for items delivering feature')).toBe(true)
    expect(isOptionalNote('only if you use the radio addon')).toBe(true)
    expect(isOptionalNote('Latest version required')).toBe(false)
    expect(isOptionalNote('Required version 0.5.31 or newer')).toBe(false)
    expect(isOptionalNote('')).toBe(false)
    expect(isOptionalNote('NOT optional - the mod crashes without it')).toBe(false)
    expect(isOptionalNote('nicht optional!')).toBe(false)
  })
})

describe('Shards', () => {
  const mods = [
    rec('cet', { nexusModId: 107, nexusFileId: 5001, nexusFile: 'CET 1.38', name: 'Cyber Engine Tweaks', version: '1.38.0' }),
    rec('garage-core', { nexusModId: 30297, nexusFileId: 21, nexusFile: 'Garage Core', name: 'Garage Core' }),
    rec('local', { kind: 'file', name: 'My Retexture', version: '2' }),
    rec('off', { nexusModId: 400, name: 'Disabled One' }),
  ]
  const profile: Profile = { name: 'Default', order: ['garage-core', 'cet', 'local', 'off'], enabled: { cet: true, 'garage-core': true, local: true, off: false } }

  it('baut aus dem Inventar eine Liste in Prioritäts-Reihenfolge', () => {
    const all = shardFromInventory(mods, profile, '  Mein Build ', false, '2.5')
    expect(all.title).toBe('Mein Build')
    expect(all.mods.map((m) => m.modId)).toEqual([30297, 107, 400])
    expect(all.mods[2]).toMatchObject({ fileId: 0, on: false })
    expect(all.local).toEqual([{ name: 'My Retexture', version: '2' }])
    expect(shardFromInventory(mods, profile, 'x', true, null).mods.map((m) => m.modId)).toEqual([30297, 107])
  })

  it('Code und Datei überstehen den Weg hin und zurück', () => {
    const s = shardFromInventory(mods, profile, 'Night City Ü', false, '2.5')
    const code = encodeShard(s)
    expect(code.startsWith('RDSHARD1:')).toBe(true)
    expect(code).not.toMatch(/[+/=\s]/)
    for (const back of [decodeShard(code), decodeShard(`Hier mein Build:\n${code}\n`), decodeShard(shardFile(s))]) {
      expect(back.title).toBe('Night City Ü')
      expect(back.patch).toBe('2.5')
      expect(back.mods).toEqual(s.mods)
      expect(back.local).toEqual(s.local)
    }
  })

  it('lehnt Kaputtes ab und übernimmt nichts Halbes', () => {
    expect(() => decodeShard('hallo')).toThrow(/Shard/)
    expect(() => decodeShard('RDSHARD1:@@@@')).toThrow(/Shard/)
    expect(() => decodeShard('{"rd":2,"m":[]}')).toThrow(/Shard/)
    // Unsinnige Einträge fallen weg, gültige bleiben
    const s = decodeShard(JSON.stringify({ rd: 1, t: 'x', m: [[-1, 2, 'a'], ['7', 1, 'b'], [5, 0, 'ok', '1.0', 1], 'kaputt'], l: [[1, 2]] }))
    expect(s.mods).toEqual([{ modId: 5, fileId: 0, name: 'ok', version: '1.0', on: true, title: undefined }])
    expect(s.local).toEqual([{ name: '?', version: '?' }])
    // Entpackbombe: winziger Code, riesiger Inhalt
    const bomb = 'RDSHARD1:' + deflateRawSync(Buffer.from(`{"rd":1,"t":"${'x'.repeat(6 * 1024 * 1024)}","m":[]}`)).toString('base64url')
    expect(bomb.length).toBeLessThan(20_000)
    expect(() => decodeShard(bomb)).toThrow(/Shard/)
    // Ungültiges Datum wird nicht angezeigt
    expect(decodeShard(JSON.stringify({ rd: 1, t: 'x', c: 'gestern', m: [] })).created).toBe('')
  })

  it('Text zum Posten enthält Nexus-Links', () => {
    const text = shardText(shardFromInventory(mods, profile, 'Build', false, '2.5'))
    expect(text).toContain('https://www.nexusmods.com/cyberpunk2077/mods/107')
    expect(text).toContain('My Retexture')
  })
})

describe('Plan-Abgleich', () => {
  const plan = collectionPlan(
    {
      slug: 'abc123',
      name: 'Test Collection',
      author: 'Ann',
      summary: null,
      picture: null,
      revision: 3,
      adult: false,
      files: [
        { fileId: 21, optional: false, file: { fileId: 21, name: 'Garage Core', version: '1.0.4', modId: 30297, size: 10, category: 'MAIN', mod: { modId: 30297, name: 'Garage', author: 'C', picture: null, adult: false, available: true } } },
        { fileId: 22, optional: false, file: { fileId: 22, name: 'Garage Service Ammo', version: '1.0.0', modId: 30297, size: 20, category: 'MAIN', mod: { modId: 30297, name: 'Garage', author: 'C', picture: null, adult: false, available: true } } },
        { fileId: 9, optional: true, file: { fileId: 9, name: 'CET 1.38', version: '1.38.0', modId: 107, size: 30, category: 'MAIN', mod: { modId: 107, name: 'CET', author: 'y', picture: null, adult: false, available: true } } },
        { fileId: 77, optional: false, file: null },
        { fileId: 88, optional: false, file: { fileId: 88, name: 'Gone', version: '1', modId: 500, size: 1, category: 'MAIN', mod: { modId: 500, name: 'Hidden', author: null, picture: null, adult: true, available: false } } },
      ],
    },
    'p1',
  )

  it('was ist da, was ist eine andere Version, was fehlt, was gibt es nicht', () => {
    const mods = [
      rec('core', { nexusModId: 30297, nexusFileId: 21, nexusFile: 'Garage Core' }),
      rec('cet', { nexusModId: 107, nexusFileId: 5, nexusFile: 'CET 1.37' }),
    ]
    const dl: DownloadItem = { id: 'd1', name: 'x', fileName: 'x.zip', version: '1', nexusModId: 30297, nexusFileId: 22, total: 0, received: 0, speed: 0, state: 'downloading' }
    const r = resolvePlan(plan, mods, [dl])
    const by = Object.fromEntries(r.entries.map((e) => [e.key, e]))
    expect(by['30297:21']).toMatchObject({ state: 'installed', recordId: 'core' })
    // Anderer Teil desselben Multi-File-Mods: fehlt (nicht "Update" von Garage Core)
    expect(by['30297:22']).toMatchObject({ state: 'missing', download: { id: 'd1', state: 'downloading' } })
    // Gleicher Dateititel bis auf die Versionsnummer darin: andere Version derselben Datei
    expect(by['107:9']).toMatchObject({ state: 'update', recordId: 'cet' })
    expect(by['0:77'].state).toBe('unavailable')
    expect(by['500:88']).toMatchObject({ state: 'unavailable', adult: true })
  })

  it('erkennt eine andere Version derselben Datei am Titel', () => {
    const r = resolvePlan(plan, [rec('core-old', { nexusModId: 30297, nexusFileId: 11, nexusFile: 'Garage Core' })], [])
    expect(r.entries.find((e) => e.key === '30297:21')).toMatchObject({ state: 'update', recordId: 'core-old' })
    expect(r.entries.find((e) => e.key === '30297:22')?.state).toBe('missing')
  })

  it('kein stilles Downgrade: gleich alte oder neuere installierte Datei ist "older"', () => {
    const newer = resolvePlan(plan, [rec('core-new', { nexusModId: 30297, nexusFileId: 99, nexusFile: 'Garage Core', version: '1.0.5' })], [])
    expect(newer.entries.find((e) => e.key === '30297:21')).toMatchObject({ state: 'older', recordId: 'core-new', installedVersion: '1.0.5' })
    const same = resolvePlan(plan, [rec('core-same', { nexusModId: 30297, nexusFileId: 99, nexusFile: 'Garage Core', version: '1.0.4' })], [])
    expect(same.entries.find((e) => e.key === '30297:21')?.state).toBe('older')
    const older = resolvePlan(plan, [rec('core-old', { nexusModId: 30297, nexusFileId: 11, nexusFile: 'Garage Core', version: '1.0.1' })], [])
    expect(older.entries.find((e) => e.key === '30297:21')).toMatchObject({ state: 'update', installedVersion: '1.0.1' })
  })

  it('offener Import-Dialog zählt als laufend (nicht noch einmal laden)', () => {
    const r = resolvePlan(plan, [], [], new Set(['30297:22']))
    expect(r.entries.find((e) => e.key === '30297:22')?.download).toEqual({ id: '', state: 'done' })
    expect(r.entries.find((e) => e.key === '30297:21')?.download).toBeUndefined()
  })

  it('Datei-ID 0 bei mehreren Dateien eines Mods: der Titel entscheidet', () => {
    const p = shardPlan(
      { title: 's', patch: null, created: '', mods: [{ modId: 30297, fileId: 0, name: 'Garage', version: '1', title: 'Garage Service Ammo', on: true }], local: [] },
      'p3',
      new Map(),
    )
    const mods = [
      rec('core', { nexusModId: 30297, nexusFileId: 21, nexusFile: 'Garage Core' }),
      rec('ammo', { nexusModId: 30297, nexusFileId: 22, nexusFile: 'Garage Service Ammo' }),
    ]
    expect(resolvePlan(p, mods, []).entries[0]).toMatchObject({ state: 'installed', recordId: 'ammo' })
    expect(resolvePlan(p, [mods[0]], []).entries[0].state).toBe('installed') // nur ein Mod mit der ID: der zählt
  })

  it('Shard ohne Datei-ID (0) gilt als da, wenn der Mod da ist', () => {
    const p = shardPlan({ title: 's', patch: null, created: '', mods: [{ modId: 400, fileId: 0, name: 'X', version: '1', on: false }], local: [] }, 'p2', new Map())
    expect(resolvePlan(p, [rec('x', { nexusModId: 400 })], []).entries[0]).toMatchObject({ state: 'installed', optional: true, enabled: false })
  })
})

describe('Update-Check bei Multi-File-Mods', () => {
  // Garage: mehrere Hauptdateien unter einer Mod-ID, die Mod-Version folgt nur der Core-Datei
  const garage: NexusFiles = {
    files: [
      { file_id: 20, name: 'Garage Core', version: '1.0.3', category_name: 'OLD_VERSION', file_name: 'core-103.zip', uploaded_timestamp: 1 },
      { file_id: 21, name: 'Garage Core', version: '1.0.4', category_name: 'MAIN', file_name: 'core-104.zip', uploaded_timestamp: 5 },
      { file_id: 22, name: 'Garage Service Ammo', version: '1.0.0', category_name: 'MAIN', file_name: 'ammo.zip', uploaded_timestamp: 2 },
      { file_id: 23, name: 'Garage Service Paint', version: '1.0.1', category_name: 'MAIN', file_name: 'paint-101.zip', uploaded_timestamp: 6 },
    ],
    file_updates: [],
  }

  it('meldet für einen aktuellen Service-Teil kein Update auf Garage Core', () => {
    expect(computeUpdate({ version: '1.0.0', fileId: 22, title: 'Garage Service Ammo', category: 'MAIN' }, '1.0.4', garage)).toMatchObject({
      hasUpdate: false,
      latestFileId: null,
    })
  })
  it('folgt ohne Update-Kette dem Nachfolger mit gleichem Titel', () => {
    expect(computeUpdate({ version: '1.0.3', fileId: 20, title: 'Garage Core', category: 'MAIN' }, '1.0.4', garage)).toMatchObject({
      hasUpdate: true,
      latestFileId: 21,
    })
    // Datei bei Nexus ganz weg (archiviert), Titel aus dem Archivnamen bekannt
    expect(computeUpdate({ version: '1.0.0', fileId: 19, title: 'Garage Service Paint', category: 'MAIN' }, '1.0.4', garage)).toMatchObject({
      hasUpdate: true,
      latestFileId: 23,
    })
  })
  it('veraltet, aber kein eindeutiger Nachfolger: Update ohne Datei (auf Nexus wählen)', () => {
    expect(computeUpdate({ version: '0.9', fileId: 18, title: 'Garage Extra', category: 'MAIN' }, '1.0.4', garage)).toMatchObject({
      hasUpdate: true,
      latestFileId: null,
    })
  })
})

describe('Hauptdatei eines Mods', () => {
  const f = (id: number, name: string, cat: string, ts: number, primary = false) => ({
    file_id: id,
    name,
    version: '1',
    category_name: cat,
    file_name: `${id}.zip`,
    uploaded_timestamp: ts,
    is_primary: primary,
  })
  it('primär markiert, sonst die neueste gleichnamige MAIN', () => {
    expect(pickMainFile({ files: [f(1, 'A', 'MAIN', 1), f(2, 'B', 'MAIN', 2, true)], file_updates: [] })?.file_id).toBe(2)
    expect(pickMainFile({ files: [f(1, 'ArchiveXL', 'MAIN', 1), f(3, 'ArchiveXL', 'MAIN', 3), f(4, 'Docs', 'OPTIONAL', 9)], file_updates: [] })?.file_id).toBe(3)
  })
  it('mehrere verschiedene Hauptdateien: mehrdeutig', () => {
    expect(pickMainFile({ files: [f(1, 'Garage Core', 'MAIN', 1), f(2, 'Garage Ammo', 'MAIN', 2)], file_updates: [] })).toBeNull()
    expect(pickMainFile({ files: [f(1, 'Only optional', 'OPTIONAL', 1)], file_updates: [] })).toBeNull()
  })
})
