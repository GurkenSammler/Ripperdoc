import { BRAND } from '@shared/brand'
import { hhmm, t } from '@shared/i18n'
import { NEXUS_GAME } from './nxm'
import type { NexusFiles } from './updates'

// Kleiner Client für die Nexus-API v1. Schlüssel kommt per Funktion (liegt verschlüsselt im KeyStore).
// Nexus ist manchmal langsam oder gestört: jede Anfrage hat ein Zeitlimit, Störungen (Netz, 5xx, Cloudflare)
// werden zweimal wiederholt, erst dann gibt es einen Fehler. Echte Antworten (401, 404, …) nie wiederholen.

export const API = 'https://api.nexusmods.com/v1'

export class NexusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }

  /** Störung auf dem Weg oder bei Nexus, kein Problem mit Key oder Anfrage. */
  get transient(): boolean {
    return this.status === 0 || this.status === 408 || this.status >= 500
  }
}

export interface ValidateResult {
  user_id: number
  name: string
  is_premium: boolean
  is_supporter: boolean
}

export interface ModInfo {
  mod_id: number
  name: string
  summary?: string
  version: string
  author?: string
  picture_url?: string | null
  updated_timestamp?: number
  available?: boolean
  status?: string
}

export interface DownloadLink {
  name: string
  short_name: string
  URI: string
}

type FetchFn = typeof fetch

export interface ClientOptions {
  fetchImpl?: FetchFn
  timeoutMs?: number // je Versuch
  retryDelays?: number[] // Pausen zwischen den Versuchen; Länge = Anzahl Wiederholungen
  sleep?: (ms: number) => Promise<void>
  /** Nach jeder Anfrage: null = Nexus hat geantwortet, sonst die Störung nach allen Versuchen. */
  onHealth?: (err: NexusError | null) => void
}

const TIMEOUT = 20_000
const RETRY_DELAYS = [1500, 5000]

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** "2026-10-25T22:00:00+00:00" → "23:00" (Ortszeit). */
const clock = (iso: string | null): string | null => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? hhmm(ms) : null
}

/** Grund aus einem fetch-Fehler: "fetch failed" allein sagt nichts, die Ursache steckt in cause.code. */
export const netReason = (err: Error): string => {
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause
  return cause?.code ?? cause?.message ?? err.message
}

export class NexusClient {
  rate: { hourly: number; daily: number } | null = null

  constructor(
    private readonly key: () => string | null,
    private readonly appVersion: string,
    private readonly o: ClientOptions = {},
  ) {}

  private headers(): Record<string, string> {
    const key = this.key()
    if (!key) throw new NexusError(t('main.nexus.noKey'), 401)
    return {
      apikey: key,
      accept: 'application/json',
      'Application-Name': BRAND.userAgent,
      'Application-Version': this.appVersion,
      'User-Agent': `${BRAND.userAgent}/${this.appVersion} (Windows)`,
    }
  }

  private async get<T>(path: string): Promise<T> {
    const headers = this.headers()
    const delays = this.o.retryDelays ?? RETRY_DELAYS
    let last: NexusError | null = null
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt > 0) await (this.o.sleep ?? sleep)(delays[attempt - 1])
      try {
        const data = await this.once<T>(path, headers)
        this.o.onHealth?.(null)
        return data
      } catch (err) {
        const e = err instanceof NexusError ? err : new NexusError(t('main.nexus.error', (err as Error).message), 0)
        if (!e.transient) {
          // Nexus hat geantwortet, nur eben mit Nein; ein Limit zählt aber wie eine Störung (später noch mal)
          this.o.onHealth?.(e.status === 429 ? e : null)
          throw e
        }
        last = e
      }
    }
    this.o.onHealth?.(last)
    throw last!
  }

  private async once<T>(path: string, headers: Record<string, string>): Promise<T> {
    const timeout = this.o.timeoutMs ?? TIMEOUT
    let res: Response
    let text: string
    try {
      res = await (this.o.fetchImpl ?? fetch)(API + path, { headers, signal: AbortSignal.timeout(timeout) })
      text = await res.text()
    } catch (err) {
      const e = err as Error
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        throw new NexusError(t('main.nexus.timeout', Math.round(timeout / 1000)), 0)
      }
      throw new NexusError(t('main.nexus.unreachable', netReason(e)), 0)
    }
    const hourly = Number(res.headers.get('x-rl-hourly-remaining'))
    const daily = Number(res.headers.get('x-rl-daily-remaining'))
    if (Number.isFinite(hourly) && Number.isFinite(daily) && res.headers.has('x-rl-daily-remaining')) this.rate = { hourly, daily }

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
    if (res.ok) {
      if (body === undefined) throw new NexusError(t('main.nexus.badData'), 502)
      return body as T
    }
    const message = (body as { message?: string } | undefined)?.message ?? ''
    // Cloudflare-Seite statt API-Antwort: Schutz oder Überlast, kein Nein von Nexus
    const html = /text\/html/i.test(res.headers.get('content-type') ?? '') || /^\s*</.test(text)
    if (html && (res.status === 403 || res.status === 503 || res.status >= 520)) {
      throw new NexusError(t('main.nexus.overloaded', res.status), 503)
    }
    switch (res.status) {
      case 401:
        throw new NexusError(t('main.nexus.keyInvalid'), 401)
      case 403:
        throw new NexusError(/premium/i.test(message) ? t('main.nexus.premiumOnly') : t('main.nexus.denied', message), 403)
      case 404:
        throw new NexusError(t('main.nexus.notFound'), 404)
      case 410:
        throw new NexusError(t('main.nexus.linkExpired'), 410)
      case 429: {
        const daily = res.headers.get('x-rl-daily-remaining') === '0'
        const at = clock(res.headers.get(daily ? 'x-rl-daily-reset' : 'x-rl-hourly-reset'))
        throw new NexusError(t('main.nexus.rateLimited', daily, at), 429)
      }
      default:
        throw new NexusError(res.status >= 500 ? t('main.nexus.outage', res.status) : t('main.nexus.httpError', res.status, message), res.status)
    }
  }

  validate(): Promise<ValidateResult> {
    return this.get('/users/validate.json')
  }

  mod(modId: number): Promise<ModInfo> {
    return this.get(`/games/${NEXUS_GAME}/mods/${modId}.json`)
  }

  files(modId: number): Promise<NexusFiles> {
    return this.get(`/games/${NEXUS_GAME}/mods/${modId}/files.json`)
  }

  /** Mit key/expires aus einem nxm-Link für alle; ohne nur mit Premium. */
  downloadLinks(modId: number, fileId: number, auth?: { key: string; expires: number }): Promise<DownloadLink[]> {
    const qs = auth ? `?key=${encodeURIComponent(auth.key)}&expires=${auth.expires}` : ''
    return this.get(`/games/${NEXUS_GAME}/mods/${modId}/files/${fileId}/download_link.json${qs}`)
  }
}
