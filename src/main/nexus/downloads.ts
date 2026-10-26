import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createWriteStream, promises as fs, type WriteStream } from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { DownloadItem, NexusMeta } from '@shared/types'
import { netReason, sleep } from './client'

// Download-Warteschlange: eine Datei nach der anderen (Nexus-CDN ist schnell genug), Fortschritt gedrosselt
// an die Oberfläche, Abbruch über AbortController, fertige Datei erst nach dem letzten Byte umbenannt.
// Robust gegen Störungen: Nexus-Daten werden erst im Auftrag geholt (ein nxm-Klick geht nie verloren),
// abgebrochene Verbindungen laden per Range an der Abbruchstelle weiter, bei mehreren CDN-Servern wird
// gewechselt, und ohne Daten für STALL ms gilt die Verbindung als hängend.

export interface PreparedDownload {
  name: string
  fileName: string
  version: string
  total: number
  meta: NexusMeta
}

export interface DownloadJob {
  name: string // vorläufig, bis prepare() die Nexus-Daten geholt hat
  version: string
  modId: number
  fileId: number
  linkExpires?: number
  prepare: () => Promise<PreparedDownload>
  resolveUrls: () => Promise<string[]>
}

interface Running {
  job: DownloadJob
  item: DownloadItem
  abort: AbortController
  prepared: PreparedDownload | null
}

export interface QueueOptions {
  dir: string
  emit: (items: DownloadItem[]) => void
  onDone: (item: DownloadItem, file: string, meta: NexusMeta) => Promise<void>
  fetchImpl?: typeof fetch
  stallMs?: number
  retryDelays?: number[]
  sleep?: (ms: number) => Promise<void>
}

const STALL = 30_000
const RETRY_DELAYS = [2000, 5000, 10_000]
const ACTIVE = new Set<DownloadItem['state']>(['queued', 'preparing', 'downloading'])

/** Fehler beim Laden selbst; `retry` = lohnt einen neuen Versuch, `relink` = vorher neue Links holen. */
class DownloadError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
    readonly relink = false,
  ) {
    super(message)
  }
}

const safeFileName = (n: string): string => n.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'download.zip'

const untilAbort = <T,>(p: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const onAbort = () => reject(new DownloadError(t('main.download.canceled'), false))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })

export class DownloadQueue {
  readonly items: DownloadItem[] = []
  private readonly jobs = new Map<string, Running>()
  private busy = false
  private lastEmit = 0

  constructor(private readonly o: QueueOptions) {}

  /** Neuer Auftrag; dieselbe Datei, die schon wartet oder lädt, kommt nicht doppelt in die Liste. */
  add(job: DownloadJob): DownloadItem {
    const dup = [...this.jobs.values()].find((r) => r.job.modId === job.modId && r.job.fileId === job.fileId && ACTIVE.has(r.item.state))
    if (dup) return dup.item
    const item: DownloadItem = {
      id: randomBytes(4).toString('hex'),
      name: job.name,
      fileName: '',
      version: job.version,
      nexusModId: job.modId,
      nexusFileId: job.fileId,
      total: 0,
      received: 0,
      speed: 0,
      state: 'queued',
      linkExpires: job.linkExpires,
    }
    this.items.unshift(item)
    this.jobs.set(item.id, { job, item, abort: new AbortController(), prepared: null })
    this.emit(true)
    void this.pump()
    return item
  }

  cancel(id: string): void {
    const r = this.jobs.get(id)
    if (!r) return
    if (r.item.state === 'queued') r.item.state = 'canceled'
    r.abort.abort()
    this.emit(true)
  }

  /** Fehlgeschlagenen oder abgebrochenen Download noch einmal; ein Teilstück wird weitergeladen. */
  retry(id: string): DownloadItem {
    const r = this.jobs.get(id)
    if (!r) throw new Error(t('main.download.gone'))
    if (r.item.state !== 'error' && r.item.state !== 'canceled') return r.item
    r.abort = new AbortController()
    Object.assign(r.item, { state: 'queued', error: undefined, note: undefined, speed: 0, finishedAt: undefined })
    this.emit(true)
    void this.pump()
    return r.item
  }

  clearFinished(): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]
      if (['done', 'error', 'canceled'].includes(item.state)) {
        // Teilstücke von Fehlschlägen nicht liegen lassen
        if (item.state === 'error' && item.fileName) void fs.rm(this.partOf(item), { force: true }).catch(() => undefined)
        this.jobs.delete(item.id)
        this.items.splice(i, 1)
      }
    }
    this.emit(true)
  }

  private partOf(item: DownloadItem): string {
    return path.join(this.o.dir, `${item.fileName}.part`)
  }

  private emit(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 250) return
    this.lastEmit = now
    this.o.emit(this.items.map((i) => ({ ...i })))
  }

  private async pump(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      for (;;) {
        // Map behält die Einfüge-Reihenfolge: ältester wartender Auftrag zuerst
        const next = [...this.jobs.values()].find((r) => r.item.state === 'queued')
        if (!next) break
        await this.run(next)
      }
    } finally {
      this.busy = false
    }
  }

  private async run(r: Running): Promise<void> {
    const { item, abort } = r
    item.startedAt = Date.now()
    try {
      if (!r.prepared) {
        item.state = 'preparing'
        this.emit(true)
        const p = await untilAbort(r.job.prepare(), abort.signal)
        r.prepared = p
        Object.assign(item, { name: p.name, fileName: safeFileName(p.fileName), version: p.version, total: p.total })
      }
      if (abort.signal.aborted) throw new DownloadError(t('main.download.canceled'), false)
      item.state = 'downloading'
      this.emit(true)
      const dest = path.join(this.o.dir, item.fileName)
      await fs.mkdir(this.o.dir, { recursive: true })
      const existing = await fs.stat(dest).catch(() => null)
      if (existing && item.total > 0 && existing.size === item.total) {
        // Schon einmal geladen (gleiche Größe): nicht noch mal ziehen
        item.received = item.total
      } else {
        await this.fetchWithRetries(r, this.partOf(item))
        await fs.rename(this.partOf(item), dest)
      }
      item.state = 'done'
      item.speed = 0
      item.note = undefined
      item.finishedAt = Date.now()
      this.emit(true)
      await this.o.onDone(item, dest, r.prepared.meta)
    } catch (err) {
      item.speed = 0
      item.note = undefined
      item.finishedAt = Date.now()
      if (abort.signal.aborted) {
        item.state = 'canceled'
        if (item.fileName) await fs.rm(this.partOf(item), { force: true }).catch(() => undefined)
      } else {
        item.state = 'error'
        item.error = (err as Error).message
      }
      this.emit(true)
    }
  }

  private async fetchWithRetries(r: Running, part: string): Promise<void> {
    const delays = this.o.retryDelays ?? RETRY_DELAYS
    let urls: string[] = []
    for (let attempt = 0; ; attempt++) {
      try {
        // Fehler hier kommen vom Nexus-Client, der selbst schon wiederholt hat
        if (!urls.length) urls = await untilAbort(r.job.resolveUrls(), r.abort.signal)
        if (!urls.length) throw new DownloadError(t('main.download.noLink'), false)
        await this.fetchOnce(r, urls[attempt % urls.length], part)
        return
      } catch (err) {
        if (r.abort.signal.aborted || !(err instanceof DownloadError) || !err.retry || attempt >= delays.length) throw err
        if (err.relink) urls = []
        r.item.note = t('main.download.retrying', err.message, attempt + 2, delays.length + 1, Math.round(delays[attempt] / 1000), urls.length > 1)
        r.item.speed = 0
        this.emit(true)
        await untilAbort((this.o.sleep ?? sleep)(delays[attempt]), r.abort.signal)
      }
    }
  }

  private async fetchOnce(r: Running, url: string, part: string): Promise<void> {
    const { item } = r
    const have = (await fs.stat(part).catch(() => null))?.size ?? 0
    const ctrl = new AbortController()
    const onAbort = () => ctrl.abort()
    r.abort.signal.addEventListener('abort', onAbort, { once: true })
    const stallMs = this.o.stallMs ?? STALL
    let stalled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        stalled = true
        ctrl.abort()
      }, stallMs)
    }
    let out: WriteStream | null = null
    arm()
    try {
      const res = await (this.o.fetchImpl ?? fetch)(url, { signal: ctrl.signal, headers: have > 0 ? { range: `bytes=${have}-` } : undefined })
      if (res.status === 416) {
        // Teilstück passt nicht (mehr) zur Datei auf dem Server: von vorn
        void res.body?.cancel().catch(() => undefined)
        await fs.rm(part, { force: true })
        throw new DownloadError(t('main.download.partMismatch'), true)
      }
      if (!res.ok || !res.body) {
        void res.body?.cancel().catch(() => undefined)
        const s = res.status
        const expired = s === 403 || s === 410 // CDN-Links laufen ab
        throw new DownloadError(t('main.download.httpFailed', s), expired || s === 408 || s === 429 || s >= 500, expired)
      }
      const resumed = res.status === 206 && have > 0
      const expected = resumed
        ? Number(res.headers.get('content-range')?.match(/\/(\d+)\s*$/)?.[1])
        : Number(res.headers.get('content-length'))
      const known = Number.isFinite(expected) && expected > 0
      if (known) item.total = expected
      item.received = resumed ? have : 0
      if (resumed) item.resumed = true
      out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      let windowStart = Date.now()
      let windowBytes = 0
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        arm()
        if (!out.write(chunk)) await once(out, 'drain')
        item.received += chunk.length
        item.note = undefined
        windowBytes += chunk.length
        const dt = Date.now() - windowStart
        if (dt >= 500) {
          item.speed = Math.round((windowBytes / dt) * 1000)
          windowStart = Date.now()
          windowBytes = 0
        }
        this.emit()
      }
      out.end()
      await once(out, 'finish')
      if (known && item.received < expected) throw new DownloadError(t('main.download.endedEarly'), true)
    } catch (err) {
      if (r.abort.signal.aborted) throw err
      if (stalled) throw new DownloadError(t('main.download.stalled', Math.round(stallMs / 1000)), true)
      if (err instanceof DownloadError) throw err
      throw new DownloadError(t('main.download.dropped', netReason(err as Error)), true)
    } finally {
      clearTimeout(timer)
      r.abort.signal.removeEventListener('abort', onAbort)
      if (out && !out.closed) {
        // Schon empfangene Bytes noch auf die Platte (Teilstück zum Weiterladen), nicht mit destroy() verwerfen
        const o = out
        await new Promise<void>((resolve) => {
          o.once('close', () => resolve())
          o.once('error', () => o.destroy())
          if (!o.writableEnded) o.end()
        })
      }
    }
  }
}
