import path from 'node:path'
import { promises as fs } from 'node:fs'
import { t } from '@shared/i18n'
import type {
  DownloadItem,
  ModOrigin,
  ModRecord,
  NexusHealth,
  NexusMeta,
  NexusOutage,
  NexusStatus,
  NexusUser,
  NxmState,
  UpdateInfo,
} from '@shared/types'
import { fileTitleOf } from '../mods/identity'
import { readJson, writeJson } from '../util/paths'
import { NexusClient, NexusError } from './client'
import { DownloadQueue } from './downloads'
import { KeyStore, type Crypto } from './keystore'
import { NEXUS_GAME, parseNxm, redactNxm } from './nxm'
import { RequirementsCache } from './requirements'
import { fetchHealth } from './statuspage'
import { computeUpdate, pickMainFile, predecessors, thumbnailOf } from './updates'

/** Wie ein Download weiterbehandelt wird: ohne Dialog installieren, wenn klar; woher er kommt. */
export interface DownloadTags {
  auto?: boolean
  origin?: ModOrigin
}

// Alles rund um Nexus: Key, Konto-Status, nxm-Links, Downloads, Update-Check.
// Bei Störungen bleibt das zuletzt bekannte Konto stehen (Premium-Downloads gehen weiter, sobald Nexus
// antwortet), RIPPERDOC versucht es im Hintergrund mit wachsenden Pausen neu und holt danach nach.

export interface ProtocolControl {
  status(): { state: NxmState; other: string | null }
  set(on: boolean): boolean
}

/** Zeiten fürs Netz; nur Tests setzen das (kurze Pausen statt Sekunden). */
export interface NetTuning {
  timeoutMs?: number
  retryDelays?: number[]
  downloadRetryDelays?: number[]
  reconnectDelays?: number[]
  stallMs?: number
  sleep?: (ms: number) => Promise<void>
}

export interface NexusServiceOptions {
  userData: string
  dataRoot: string
  appVersion: string
  crypto: Crypto
  protocol: ProtocolControl | null
  emitDownloads: (items: DownloadItem[]) => void
  emitStatus: () => void
  onDownloaded: (file: string, meta: NexusMeta) => Promise<void>
  onRecovered?: () => void // Nexus antwortet nach einer Störung wieder
  fetchImpl?: typeof fetch
  tuning?: NetTuning
}

interface UpdateCache {
  checkedAt: string | null
  results: Record<string, UpdateInfo>
}

type Account = NexusUser & { id: number }

const UPDATE_TTL = 6 * 60 * 60 * 1000
const RECONNECT = [30_000, 60_000, 120_000, 300_000, 600_000]
const HEALTH_TTL = 3 * 60 * 1000
const UPDATE_WORKERS = 3
const EXPECT_TTL = 30 * 60 * 1000
const ENDORSE_TTL = 10 * 60 * 1000

/** Störung oder Limit: nicht die Schuld des Keys, später noch einmal. */
const isOutage = (err: unknown): err is NexusError => err instanceof NexusError && (err.transient || err.status === 429)

export class NexusService {
  readonly keys: KeyStore
  readonly client: NexusClient
  readonly queue: DownloadQueue
  user: Account | null = null
  verified = false
  checking = false
  error: string | null = null
  outage: NexusOutage | null = null
  health: NexusHealth | null = null
  private cache: UpdateCache = { checkedAt: null, results: {} }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectStep = 0
  private healthPending: Promise<void> | null = null
  readonly reqs: RequirementsCache
  // Dateien aus einem Plan, deren nxm-Klick ohne Premium noch kommt: "<modId>:<fileId>" (0 = Hauptdatei)
  // plan: aus welchem Plan (zum Vergessen beim Schließen); at: Ablauf nach EXPECT_TTL
  private readonly expected = new Map<string, { tags: DownloadTags; plan?: string; at: number }>()
  private endorsed: { at: number; ids: Set<number> } | null = null

  constructor(private readonly o: NexusServiceOptions) {
    const tune = o.tuning ?? {}
    this.reqs = new RequirementsCache(path.join(o.dataRoot, 'nexus-requirements.json'))
    this.keys = new KeyStore(path.join(o.userData, 'nexus-key.bin'), o.crypto)
    this.client = new NexusClient(() => this.keys.key, o.appVersion, {
      fetchImpl: o.fetchImpl,
      timeoutMs: tune.timeoutMs,
      retryDelays: tune.retryDelays,
      sleep: tune.sleep,
      onHealth: (err) => this.onHealth(err),
    })
    this.queue = new DownloadQueue({
      dir: path.join(o.dataRoot, 'downloads'),
      emit: o.emitDownloads,
      onDone: (_item, file, meta) => o.onDownloaded(file, meta),
      fetchImpl: o.fetchImpl,
      stallMs: tune.stallMs,
      retryDelays: tune.downloadRetryDelays,
      sleep: tune.sleep,
    })
  }

  private get cacheFile(): string {
    return path.join(this.o.dataRoot, 'nexus-updates.json')
  }

  /** Name + Premium vom letzten erfolgreichen Login (kein Geheimnis, nur für den Offline-Fall). */
  private get accountFile(): string {
    return path.join(this.o.userData, 'nexus-account.json')
  }

  /** Ohne Netz: das Fenster soll sofort kommen. Geprüft wird danach im Hintergrund (validate). */
  async init(): Promise<void> {
    this.cache = await readJson<UpdateCache>(this.cacheFile, { checkedAt: null, results: {} })
    await this.reqs.load()
    if (await this.keys.load()) this.user = await readJson<Account | null>(this.accountFile, null)
  }

  /** Konto prüfen; Fehler landen im Status statt als Ausnahme. */
  async validate(): Promise<boolean> {
    if (!this.keys.key) return false
    this.checking = true
    this.o.emitStatus()
    try {
      const v = await this.client.validate()
      this.user = { id: v.user_id, name: v.name, premium: v.is_premium, supporter: v.is_supporter }
      this.verified = true
      this.error = null
      await writeJson(this.accountFile, this.user).catch(() => undefined)
      return true
    } catch (err) {
      if (!isOutage(err)) {
        this.user = null
        this.verified = false
        this.error = (err as Error).message
      }
      // Bei einer Störung bleibt das zuletzt bekannte Konto; outage kommt über onHealth
      return false
    } finally {
      this.checking = false
      this.o.emitStatus()
    }
  }

  /** Meldung vom Client nach jeder Anfrage. */
  private onHealth(err: NexusError | null): void {
    if (!err) {
      if (!this.outage) return
      this.outage = null
      this.reconnectStep = 0
      this.stopReconnect()
      this.o.emitStatus()
      return
    }
    // Ohne Key (nur öffentliche Abfragen) gibt es keinen Neuverbindungs-Takt; eine Störungsanzeige bliebe hängen
    if (!this.keys.key) return
    const first = !this.outage
    this.outage = { message: err.message, since: this.outage?.since ?? Date.now(), retryAt: this.outage?.retryAt ?? null }
    if (!this.reconnectTimer) this.scheduleReconnect()
    if (first) void this.refreshHealth(true)
    this.o.emitStatus()
  }

  private scheduleReconnect(): void {
    if (!this.keys.key) return
    const delays = this.o.tuning?.reconnectDelays ?? RECONNECT
    const ms = delays[Math.min(this.reconnectStep++, delays.length - 1)]
    if (this.outage) this.outage.retryAt = Date.now() + ms
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.reconnect()
    }, ms)
    this.reconnectTimer.unref?.()
  }

  private stopReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.outage) this.outage.retryAt = null
  }

  /** Jetzt neu verbinden (Knopf oder Zeitplan). Klappt es, holt der Core Verpasstes nach. */
  async reconnect(): Promise<NexusStatus> {
    this.stopReconnect()
    void this.refreshHealth(true)
    if (await this.validate()) this.o.onRecovered?.()
    return this.status()
  }

  /** Öffentliche Statusseite von Nexus, höchstens alle paar Minuten. */
  async refreshHealth(force = false): Promise<void> {
    if (!force && this.health && Date.now() - this.health.checkedAt < HEALTH_TTL) return
    if (this.healthPending) return this.healthPending
    this.healthPending = (async () => {
      try {
        this.health = await fetchHealth(this.o.fetchImpl)
      } catch {
        // Statusseite selbst nicht erreichbar: alten Stand behalten
      } finally {
        this.healthPending = null
        this.o.emitStatus()
      }
    })()
    return this.healthPending
  }

  status(): NexusStatus {
    const p = this.o.protocol?.status() ?? { state: 'none' as NxmState, other: null }
    return {
      hasKey: !!this.keys.key,
      user: this.user ? { name: this.user.name, premium: this.user.premium, supporter: this.user.supporter } : null,
      verified: this.verified,
      checking: this.checking,
      error: this.error,
      outage: this.outage ? { ...this.outage } : null,
      health: this.health,
      nxm: p.state,
      nxmOther: p.other,
      rate: this.client.rate,
      canEncrypt: this.o.crypto.available(),
      lastCheck: this.cache.checkedAt,
    }
  }

  /** Neuen Key erst prüfen, dann verschlüsselt speichern. nxm:// wird registriert, wenn es frei ist. */
  async setKey(key: string): Promise<NexusStatus> {
    const clean = key.trim()
    if (!/^[A-Za-z0-9+/=_-]{20,}$/.test(clean)) throw new Error(t('main.nexus.notAKey'))
    const tune = this.o.tuning ?? {}
    const probe = new NexusClient(() => clean, this.o.appVersion, {
      fetchImpl: this.o.fetchImpl,
      timeoutMs: tune.timeoutMs,
      retryDelays: tune.retryDelays,
      sleep: tune.sleep,
    })
    let v
    try {
      v = await probe.validate()
    } catch (err) {
      if (isOutage(err)) throw new Error(t('main.nexus.keyNotSaved', (err as Error).message))
      throw err
    }
    await this.keys.save(clean)
    this.user = { id: v.user_id, name: v.name, premium: v.is_premium, supporter: v.is_supporter }
    this.verified = true
    this.error = null
    this.client.rate = probe.rate
    await writeJson(this.accountFile, this.user).catch(() => undefined)
    this.onHealth(null)
    if (this.o.protocol && this.o.protocol.status().state === 'none') this.o.protocol.set(true)
    this.o.emitStatus()
    return this.status()
  }

  async clearKey(): Promise<NexusStatus> {
    await this.keys.clear()
    await fs.rm(this.accountFile, { force: true })
    this.user = null
    this.verified = false
    this.error = null
    this.outage = null
    this.stopReconnect()
    this.o.emitStatus()
    return this.status()
  }

  setNxm(on: boolean): NexusStatus {
    this.o.protocol?.set(on)
    this.o.emitStatus()
    return this.status()
  }

  /**
   * Download sofort einreihen; Mod- und Dateidaten holt der Auftrag selbst. So geht ein Klick auf der
   * Website auch dann nicht verloren, wenn Nexus gerade hängt: der Eintrag zeigt den Fehler + „Nochmal“.
   */
  private enqueue(
    modId: number,
    fileId: number,
    auth: { key: string; expires: number } | undefined,
    replaceRecord?: string,
    tags: DownloadTags = {},
  ): DownloadItem {
    return this.queue.add({
      name: t('main.nexus.modPlaceholder', modId),
      version: '?',
      modId,
      fileId,
      linkExpires: auth?.expires,
      auto: tags.auto,
      origin: tags.origin,
      prepare: async () => {
        const [mod, files] = await Promise.all([this.client.mod(modId), this.client.files(modId)])
        const file = files.files.find((f) => f.file_id === fileId)
        if (!file) throw new Error(t('main.nexus.fileGone', fileId, modId))
        const meta: NexusMeta = {
          modId,
          fileId,
          modName: mod.name,
          fileName: file.file_name,
          version: file.version || mod.version,
          category: file.category_name ?? undefined,
          author: mod.author,
          summary: mod.summary,
          picture: thumbnailOf(mod.picture_url),
          supersedes: predecessors(files, fileId),
          replaceRecord,
          fileTitle: file.name || undefined,
          auto: tags.auto,
          origin: tags.origin,
        }
        return {
          name: file.name || mod.name,
          fileName: file.file_name,
          version: meta.version,
          total: file.size_in_bytes ?? (file.size_kb ?? 0) * 1024,
          meta,
        }
      },
      resolveUrls: async () => {
        // Freigabe aus dem nxm-Link abgelaufen (z. B. beim „Nochmal“ viel später): mit Premium geht es ohne
        let a = auth
        if (a && a.expires * 1000 < Date.now()) {
          if (!this.user?.premium) throw new Error(t('main.nexus.authExpired'))
          a = undefined
        }
        const links = await this.client.downloadLinks(modId, fileId, a)
        return links.map((l) => l.URI).filter(Boolean)
      },
    })
  }

  /** Klick auf "Mod Manager Download" auf nexusmods.com. */
  async handleNxm(raw: string): Promise<DownloadItem> {
    const link = parseNxm(raw)
    if (!link) throw new Error(t('main.nexus.unknownLink', redactNxm(raw)))
    if (link.game !== NEXUS_GAME) throw new Error(t('main.nexus.wrongGame', link.game))
    if (!this.keys.key) throw new Error(t('main.nexus.keyFirstUplink'))
    const auth = link.key && link.expires ? { key: link.key, expires: link.expires } : undefined
    if (!auth && !this.user?.premium) throw new Error(t('main.nexus.noAuth'))
    // Gehört der Klick zu einem Plan (Collection, Shard, Requirement)? Dann so weiterbehandeln wie dort gewählt
    const key = `${link.modId}:${link.fileId}`
    const hit = [this.expected.get(key), this.expected.get(`${link.modId}:0`)].find((e) => e && Date.now() - e.at < EXPECT_TTL)
    this.expected.delete(key)
    this.expected.delete(`${link.modId}:0`)
    return this.enqueue(link.modId, link.fileId, auth, undefined, hit?.tags)
  }

  /**
   * Ohne Premium: Datei, deren nxm-Klick gleich von der Website kommt (aus einem Plan). fileId 0 = Hauptdatei.
   * Gilt EXPECT_TTL lang; danach (oder nach forgetExpected) ist ein Klick wieder ein normaler Download mit Dialog.
   */
  expect(modId: number, fileId: number, tags: DownloadTags, plan?: string): void {
    const now = Date.now()
    for (const [k, e] of this.expected) if (now - e.at >= EXPECT_TTL) this.expected.delete(k)
    this.expected.set(`${modId}:${fileId}`, { tags, plan, at: now })
  }

  forgetExpected(plan: string): void {
    for (const [k, e] of this.expected) if (e.plan === plan) this.expected.delete(k)
  }

  /** Direkter Download aus der App (nur Premium), z. B. für ein Update. */
  async downloadFile(modId: number, fileId: number, replaceRecord?: string, tags?: DownloadTags): Promise<DownloadItem> {
    if (!this.user?.premium) throw new Error(t('main.nexus.premiumOnly'))
    return this.enqueue(modId, fileId, undefined, replaceRecord, tags)
  }

  /**
   * Hauptdatei eines Mods laden (Premium), z. B. ein fehlendes Requirement. Mehrere verschiedene Hauptdateien:
   * Fehler mit Hinweis, dann muss man auf Nexus selbst wählen.
   */
  async downloadMain(modId: number, tags?: DownloadTags): Promise<DownloadItem> {
    if (!this.user?.premium) throw new Error(t('main.nexus.premiumOnly'))
    const pick = pickMainFile(await this.client.files(modId))
    if (!pick) throw new NexusError(t('main.nexus.noMainFile'), 409)
    return this.enqueue(modId, pick.file_id, undefined, undefined, tags)
  }

  /** Cyberpunk-Mods, die das Konto empfohlen hat (10 min zwischengespeichert). Ohne Key: keine. */
  async endorsedMods(force = false): Promise<number[]> {
    if (!this.keys.key) return []
    if (force || !this.endorsed || Date.now() - this.endorsed.at > ENDORSE_TTL) {
      const list = await this.client.endorsements()
      const ids = list.filter((e) => e.domain_name === NEXUS_GAME && e.status === 'Endorsed').map((e) => e.mod_id)
      this.endorsed = { at: Date.now(), ids: new Set(ids) }
    }
    return [...this.endorsed.ids]
  }

  /** Empfehlen oder zurücknehmen; Nexus lehnt ab, wenn der Mod nicht über das Konto geladen wurde oder es zu früh ist. */
  async endorse(modId: number, version: string, on: boolean): Promise<number[]> {
    await this.client.endorse(modId, version || '1.0', on)
    const ids = new Set(await this.endorsedMods().catch(() => [] as number[]))
    if (on) ids.add(modId)
    else ids.delete(modId)
    this.endorsed = { at: Date.now(), ids }
    return [...ids]
  }

  get updates(): Record<string, UpdateInfo> {
    return this.cache.results
  }

  get stale(): boolean {
    return !this.cache.checkedAt || Date.now() - Date.parse(this.cache.checkedAt) > UPDATE_TTL
  }

  /**
   * Für alle Mods mit Nexus-ID prüfen, ob es Neueres gibt (2 Abfragen je Mod, 3 Mods gleichzeitig).
   * Bei einer Störung wird abgebrochen statt Nexus weiter zu fluten; ungeprüfte Mods behalten ihr altes
   * Ergebnis und der Check bleibt "fällig", damit er nach der Störung nachgeholt wird.
   */
  async checkUpdates(mods: ModRecord[]): Promise<Record<string, UpdateInfo>> {
    if (!this.keys.key) throw new Error(t('main.nexus.keyFirst'))
    const withId = mods.filter((m) => m.source.nexusModId !== undefined)
    const byNexus = new Map<number, ModRecord[]>()
    for (const m of withId) byNexus.set(m.source.nexusModId!, [...(byNexus.get(m.source.nexusModId!) ?? []), m])
    const results: Record<string, UpdateInfo> = {}
    const now = new Date().toISOString()
    const todo = [...byNexus]
    const run: { stop: NexusError | null } = { stop: null }
    const worker = async (): Promise<void> => {
      for (let next = todo.shift(); next && !run.stop; next = todo.shift()) {
        const [nexusId, recs] = next
        try {
          const [mod, files] = await Promise.all([this.client.mod(nexusId), this.client.files(nexusId)])
          for (const r of recs) {
            const u = computeUpdate(
              { version: r.version, fileId: r.source.nexusFileId, title: fileTitleOf(r), category: r.source.nexusCategory },
              mod.version,
              files,
            )
            results[r.id] = { recordId: r.id, nexusModId: nexusId, installed: r.version, checkedAt: now, ...u }
          }
        } catch (err) {
          if (isOutage(err)) {
            run.stop ??= err
            return
          }
          for (const r of recs) {
            results[r.id] = {
              recordId: r.id,
              nexusModId: nexusId,
              installed: r.version,
              latest: null,
              latestFileId: null,
              latestFileName: null,
              hasUpdate: false,
              checkedAt: now,
              error: (err as Error).message,
            }
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPDATE_WORKERS, todo.length) }, worker))
    for (const r of withId) if (!results[r.id] && this.cache.results[r.id]) results[r.id] = this.cache.results[r.id]
    this.cache = { checkedAt: run.stop ? this.cache.checkedAt : now, results }
    await writeJson(this.cacheFile, this.cache)
    this.o.emitStatus()
    if (run.stop) throw new NexusError(t('main.nexus.updatesIncomplete', run.stop.message), run.stop.status)
    return results
  }

  /** Nach Entfernen oder Update eines Mods den alten Eintrag vergessen. */
  async forget(recordId: string): Promise<void> {
    if (!this.cache.results[recordId]) return
    delete this.cache.results[recordId]
    await writeJson(this.cacheFile, this.cache)
  }

  dispose(): void {
    this.stopReconnect()
  }
}
