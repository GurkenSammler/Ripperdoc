import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Core } from '../src/main/core'
import { NexusClient, NexusError } from '../src/main/nexus/client'
import { DownloadQueue, type DownloadJob } from '../src/main/nexus/downloads'
import { KeyStore, type Crypto } from '../src/main/nexus/keystore'
import { NexusService } from '../src/main/nexus/service'
import { parseSummary } from '../src/main/nexus/statuspage'
import type { NexusFiles } from '../src/main/nexus/updates'
import type { DownloadItem, ModRecord, NexusMeta } from '../src/shared/types'
import { exists, tmpDir, writeTree } from './helpers'

// Nexus hat Störungen: langsame oder kaputte Antworten, abbrechende Downloads, Cloudflare-Seiten.
// Alles mit falschem fetch und Pausen von 0 ms.

const FAKE_CRYPTO: Crypto = {
  available: () => true,
  encrypt: (t) => Buffer.from([...t].reverse().join(''), 'utf8'),
  decrypt: (b) => [...b.toString('utf8')].reverse().join(''),
}
const KEY = 'TEST-KEY-1234567890-abcdef'
const noSleep = async (): Promise<void> => undefined
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
const VALID = { user_id: 9, name: 'Tester', is_premium: true, is_supporter: false }

/** fetch, das der Reihe nach die gegebenen Antworten liefert und mitzählt. */
function scripted(...answers: (() => Response | Promise<Response>)[]) {
  const calls: string[] = []
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input))
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]
    return next()
  }) as typeof fetch
  return { impl, calls }
}

const client = (impl: typeof fetch, health: (NexusError | null)[] = [], timeoutMs?: number) =>
  new NexusClient(() => KEY, '0.0.0-test', { fetchImpl: impl, sleep: noSleep, timeoutMs, onHealth: (e) => health.push(e) })

describe('Nexus-Client bei Störungen', () => {
  it('wiederholt 503 und kommt dann durch', async () => {
    const health: (NexusError | null)[] = []
    const f = scripted(
      () => new Response('{"message":"oops"}', { status: 503 }),
      () => new Response('', { status: 502 }),
      () => json(VALID),
    )
    expect((await client(f.impl, health).validate()).name).toBe('Tester')
    expect(f.calls).toHaveLength(3)
    expect(health).toEqual([null])
  })

  it('Netz weg: drei Versuche, dann eine Störung mit Grund', async () => {
    const health: (NexusError | null)[] = []
    const f = scripted(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })
    })
    const err = await client(f.impl, health).validate().catch((e) => e)
    expect(err).toBeInstanceOf(NexusError)
    expect(err.transient).toBe(true)
    expect(err.message).toMatch(/ECONNRESET/)
    expect(f.calls).toHaveLength(3)
    expect(health).toHaveLength(1)
    expect(health[0]).toBe(err)
  })

  it('bricht hängende Anfragen nach dem Zeitlimit ab', async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))) as typeof fetch
    const c = new NexusClient(() => KEY, '0', { fetchImpl: hang, timeoutMs: 30, retryDelays: [] })
    await expect(c.validate()).rejects.toThrow(/antwortet nicht/)
  })

  it('HTML statt JSON: Wartungs- oder Cloudflare-Seite gilt als Störung', async () => {
    const page = () => new Response('<html>Attention Required</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    const err = await client(scripted(page).impl).validate().catch((e) => e)
    expect(err.status).toBe(502)
    expect(err.transient).toBe(true)
    const cf = () => new Response('<!DOCTYPE html><title>Just a moment</title>', { status: 403, headers: { 'content-type': 'text/html' } })
    const err2 = await client(scripted(cf).impl).validate().catch((e) => e)
    expect(err2.transient).toBe(true)
    expect(err2.message).toMatch(/überlastet/)
  })

  it('echte Antworten werden nicht wiederholt; Limit nennt die Uhrzeit', async () => {
    const health: (NexusError | null)[] = []
    const f404 = scripted(() => json({ message: 'nope' }, 404))
    await expect(client(f404.impl, health).mod(1)).rejects.toThrow(/nicht gefunden/)
    expect(f404.calls).toHaveLength(1)
    expect(health).toEqual([null])

    const f429 = scripted(
      () => new Response('{}', { status: 429, headers: { 'x-rl-hourly-remaining': '0', 'x-rl-daily-remaining': '50', 'x-rl-hourly-reset': '2026-10-25T21:00:00+00:00' } }),
    )
    const err = await client(f429.impl, health).mod(1).catch((e) => e)
    expect(f429.calls).toHaveLength(1)
    expect(err.message).toMatch(/Stunde erreicht, wieder ab \d\d:\d\d Uhr/)
    expect(health.at(-1)).toBe(err) // Limit zählt wie eine Störung (später neu versuchen)
  })
})

// ---------- Downloads ----------

const PAYLOAD = Buffer.from('0123456789'.repeat(1000))

const meta = (fileId = 1): NexusMeta => ({ modId: 100, fileId, modName: 'Neon', fileName: 'neon.zip', version: '1.0' })

function job(urls: string[], over: Partial<DownloadJob> = {}): DownloadJob {
  return {
    name: 'Nexus-Mod #100',
    version: '?',
    modId: 100,
    fileId: 1,
    prepare: async () => ({ name: 'Neon', fileName: 'neon.zip', version: '1.0', total: PAYLOAD.length, meta: meta() }),
    resolveUrls: async () => urls,
    ...over,
  }
}

/** Erst ein Stück liefern, dann reißt die Verbindung. */
const cutAfter = (data: Uint8Array) => {
  let sent = false
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent) c.error(new TypeError('terminated'))
      else {
        sent = true
        c.enqueue(data)
      }
    },
  })
}

/** CDN mit Range-Unterstützung; `plan` entscheidet je Aufruf, was passiert. */
function cdn(plan: (n: number, url: string, signal: AbortSignal) => Response | null) {
  const calls: { url: string; range?: string }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const range = (init?.headers as Record<string, string> | undefined)?.range
    calls.push({ url, range })
    const special = plan(calls.length, url, init!.signal!)
    if (special) return special
    const from = range ? Number(range.match(/bytes=(\d+)-/)![1]) : 0
    const body = new Uint8Array(PAYLOAD.subarray(from))
    return range
      ? new Response(body, { status: 206, headers: { 'content-range': `bytes ${from}-${PAYLOAD.length - 1}/${PAYLOAD.length}`, 'content-length': String(body.length) } })
      : new Response(body, { headers: { 'content-length': String(body.length) } })
  }) as typeof fetch
  return { impl, calls }
}

async function queueWith(impl: typeof fetch, stallMs = 1000) {
  const dir = await tmpDir('dlq')
  const done: { item: DownloadItem; file: string }[] = []
  let items: DownloadItem[] = []
  const q = new DownloadQueue({
    dir,
    emit: (i) => (items = i),
    onDone: async (item, file) => void done.push({ item, file }),
    fetchImpl: impl,
    stallMs,
    retryDelays: [0, 0, 0],
    sleep: noSleep,
  })
  const settle = async (id: string) => {
    for (let i = 0; i < 400; i++) {
      const it = q.items.find((x) => x.id === id)!
      if (['done', 'error', 'canceled'].includes(it.state)) return it
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('Download hängt')
  }
  return { q, dir, done, settle, last: () => items }
}

describe('Downloads bei Störungen', () => {
  it('lädt nach einem Abbruch an der Abbruchstelle weiter (Range)', async () => {
    const half = PAYLOAD.length / 2
    const c = cdn((n) =>
      n === 1 ? new Response(cutAfter(new Uint8Array(PAYLOAD.subarray(0, half))), { headers: { 'content-length': String(PAYLOAD.length) } }) : null,
    )
    const { q, dir, done, settle } = await queueWith(c.impl)
    const item = q.add(job(['https://cdn.test/neon.zip']))
    expect((await settle(item.id)).state).toBe('done')
    expect(c.calls.map((x) => x.range)).toEqual([undefined, `bytes=${half}-`])
    expect(item.resumed).toBe(true)
    expect(Buffer.compare(await fs.readFile(path.join(dir, 'neon.zip')), PAYLOAD)).toBe(0)
    expect(await exists(path.join(dir, 'neon.zip.part'))).toBe(false)
    expect(done).toHaveLength(1)
  })

  it('wechselt bei einem kaputten Server auf den nächsten', async () => {
    const c = cdn((_n, url) => (url.includes('//a.') ? new Response('bad gateway', { status: 502 }) : null))
    const { q, settle } = await queueWith(c.impl)
    const item = q.add(job(['https://a.cdn.test/neon.zip', 'https://b.cdn.test/neon.zip']))
    expect((await settle(item.id)).state).toBe('done')
    expect(c.calls.map((x) => new URL(x.url).hostname)).toEqual(['a.cdn.test', 'b.cdn.test'])
  })

  it('erkennt hängende Verbindungen und versucht es neu', async () => {
    const c = cdn((n, _url, signal) =>
      n === 1 ? new Response(new ReadableStream({ start: (ctl) => signal.addEventListener('abort', () => ctl.error(signal.reason)) })) : null,
    )
    const { q, settle } = await queueWith(c.impl, 40)
    const item = q.add(job(['https://cdn.test/neon.zip']))
    expect((await settle(item.id)).state).toBe('done')
    expect(c.calls).toHaveLength(2)
  })

  it('Nexus-Daten nicht zu holen: Eintrag bleibt mit Fehler, „Nochmal“ lädt später', async () => {
    let apiDown = true
    const c = cdn(() => null)
    const { q, done, settle } = await queueWith(c.impl)
    const item = q.add(
      job(['https://cdn.test/neon.zip'], {
        prepare: async () => {
          if (apiDown) throw new NexusError('Nexus ist gerade gestört (HTTP 503).', 503)
          return { name: 'Neon', fileName: 'neon.zip', version: '1.0', total: PAYLOAD.length, meta: meta() }
        },
      }),
    )
    const failed = await settle(item.id)
    expect(failed.state).toBe('error')
    expect(failed.error).toMatch(/gestört/)
    expect(failed.name).toBe('Nexus-Mod #100')
    apiDown = false
    q.retry(item.id)
    expect((await settle(item.id)).state).toBe('done')
    expect(item.name).toBe('Neon')
    expect(done).toHaveLength(1)
  })

  it('derselbe Klick zweimal landet nur einmal in der Liste', async () => {
    const c = cdn(() => null)
    const { q, settle } = await queueWith(c.impl)
    const a = q.add(job(['https://cdn.test/neon.zip']))
    const b = q.add(job(['https://cdn.test/neon.zip']))
    expect(b.id).toBe(a.id)
    await settle(a.id)
    expect(q.items).toHaveLength(1)
  })
})

// ---------- Service: Offline-Konto, Wiederverbinden, Update-Check ----------

const FILES: NexusFiles = {
  files: [
    { file_id: 1, name: 'Main', version: '1.0', category_name: 'OLD_VERSION', file_name: 'a-1.zip', uploaded_timestamp: 1 },
    { file_id: 2, name: 'Main', version: '2.0', category_name: 'MAIN', file_name: 'a-2.zip', uploaded_timestamp: 2 },
  ],
  file_updates: [{ old_file_id: 1, new_file_id: 2 }],
}

/** Nexus-API, die man an- und ausschalten kann. */
function switchableApi() {
  const s = { down: false, calls: 0 }
  const impl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (!url.startsWith('https://api.nexusmods.com')) return new Response('nope', { status: 404 })
    s.calls++
    if (s.down) throw new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } })
    if (url.endsWith('/users/validate.json')) return json(VALID)
    if (/\/mods\/\d+\.json$/.test(url)) return json({ mod_id: 100, name: 'Neon', version: '2.0' })
    if (url.endsWith('/files.json')) return json(FILES)
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  return { s, impl }
}

const TUNING = { sleep: noSleep, reconnectDelays: [60_000], downloadRetryDelays: [0] }

describe('Nexus-Service bei Störungen', () => {
  it('Start ohne Netz-Wartezeit, altes Konto bleibt, nach der Störung wieder bestätigt', async () => {
    const base = await tmpDir('nxs')
    const game = path.join(base, 'game')
    const user = path.join(base, 'user')
    await writeTree(game, { 'bin/x64/Cyberpunk2077.exe': 'MZ', 'archive/pc/mod/.keep': '' })
    await writeTree(user, {
      'settings.json': JSON.stringify({ gameRoot: game, dataRoot: path.join(base, 'data') }),
      'nexus-account.json': JSON.stringify({ id: 9, name: 'Tester', premium: true, supporter: false }),
    })
    await new KeyStore(path.join(user, 'nexus-key.bin'), FAKE_CRYPTO).save(KEY)
    const api = switchableApi()
    api.s.down = true
    const core = new Core({ userData: user, openUrl: async () => undefined, emit: () => undefined, crypto: FAKE_CRYPTO, fetchImpl: api.impl, netTuning: TUNING })
    await core.init()
    expect(api.s.calls).toBe(0) // init fragt Nexus nicht
    expect(core.nexusStatus()).toMatchObject({ hasKey: true, user: { name: 'Tester', premium: true }, verified: false, outage: null })

    await core.backgroundNexus()
    const st = core.nexusStatus()
    expect(st.user?.premium).toBe(true) // Premium-Downloads bleiben möglich
    expect(st.error).toBeNull() // der Key ist nicht schuld
    expect(st.outage?.message).toMatch(/ETIMEDOUT/)
    expect(st.outage?.retryAt).toBeGreaterThan(Date.now())

    api.s.down = false
    const back = await core.nexus.reconnect()
    expect(back).toMatchObject({ verified: true, outage: null })
    core.nexus.dispose()
  })

  it('Update-Check bricht bei Störung ab und behält alte Ergebnisse', async () => {
    const base = await tmpDir('nxu')
    await new KeyStore(path.join(base, 'nexus-key.bin'), FAKE_CRYPTO).save(KEY)
    const api = switchableApi()
    const svc = new NexusService({
      userData: base,
      dataRoot: base,
      appVersion: '0',
      crypto: FAKE_CRYPTO,
      protocol: null,
      emitDownloads: () => undefined,
      emitStatus: () => undefined,
      onDownloaded: async () => undefined,
      fetchImpl: api.impl,
      tuning: TUNING,
    })
    await svc.init()
    const mods = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, version: '1.0', source: { nexusModId: 100 + n, nexusFileId: 1 } }) as unknown as ModRecord)
    const first = await svc.checkUpdates(mods)
    expect(Object.values(first).every((u) => u.hasUpdate)).toBe(true)
    const checkedAt = svc.status().lastCheck

    api.s.down = true
    const before = api.s.calls
    await expect(svc.checkUpdates(mods)).rejects.toThrow(/unvollständig/)
    expect(api.s.calls - before).toBeLessThanOrEqual(3 * 2 * 3) // höchstens die ersten Anfragen, kein Fluten
    expect(svc.updates.m1.hasUpdate).toBe(true)
    expect(svc.status().lastCheck).toBe(checkedAt)
    expect(svc.stale).toBe(false)
    expect(svc.status().outage).not.toBeNull()
    svc.dispose()
  })
})

describe('Nexus-Statusseite', () => {
  it('liest Zustand, Vorfall und betroffene Bereiche', () => {
    const h = parseSummary(
      {
        status: { indicator: 'minor', description: 'Partially Degraded Service' },
        components: [
          { name: 'Nexus Mods Website', status: 'degraded_performance' },
          { name: 'API', status: 'degraded_performance' },
          { name: 'CDN', status: 'operational' },
          { name: 'Gruppe', status: 'major_outage', group: true },
        ],
        incidents: [{ name: 'Slow website / API responses', status: 'monitoring', incident_updates: [{ body: 'A fix has been implemented.' }] }],
      },
      123,
    )
    expect(h).toEqual({
      indicator: 'minor',
      description: 'Partially Degraded Service',
      incident: 'Slow website / API responses',
      incidentNote: 'A fix has been implemented.',
      degraded: ['Nexus Mods Website', 'API'],
      checkedAt: 123,
    })
    expect(parseSummary({ status: { indicator: 'seltsam' } }).indicator).toBe('unknown')
  })
})
