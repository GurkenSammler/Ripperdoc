import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { GAME_EXE_REL, withVersion } from '@shared/brand'
import { FRAMEWORKS } from '@shared/frameworks'
import type { CoreEvent } from '@shared/api'
import { resolveLang, setLang, t } from '@shared/i18n'
import type {
  ApplyReport,
  AppInfo,
  DownloadsUsage,
  FetchRun,
  FrameworkId,
  GameInfo,
  ImportDecision,
  ImportFailure,
  ImportOutcome,
  ImportPreview,
  InventoryView,
  MissingDep,
  MissingNexus,
  ModPlan,
  NexusMeta,
  PlanEntry,
  NexusRequirement,
  NexusStatus,
  Notice,
  PurgeReport,
  ShareExport,
  ShareOptions,
  UpdateInfo,
  VerifyReport,
} from '@shared/types'
import { Deployer, emptyReport } from './deploy/deployer'
import { Journal } from './deploy/journal'
import { planDeployment, type Plan } from './deploy/plan'
import { compareSnapshot, loadSnapshot, saveSnapshot, takeSnapshot, type Snapshot } from './deploy/snapshot'
import { locateGame, normalizeGameRoot, type LocateSources } from './game/locate'
import { readPeVersion } from './game/peversion'
import { GameWatcher, gamePid, launchGame } from './launch'
import { ProfileStore } from './mods/profiles'
import { ModStore } from './mods/store'
import { NexusError } from './nexus/client'
import { fetchCollection, fetchModBriefs, type ModBrief } from './nexus/graph'
import type { Crypto } from './nexus/keystore'
import { fileUrl, NEXUS_GAME, parseCollectionRef } from './nexus/nxm'
import { isOptionalNote } from './nexus/requirements'
import { NexusService, type DownloadTags, type NetTuning, type ProtocolControl } from './nexus/service'
import {
  collectionPlan,
  decodeShard,
  encodeShard,
  resolvePlan,
  shardFile,
  shardFromInventory,
  shardPlan,
  shardText,
  type StoredPlan,
} from './plans'
import { defaultDataRoot, SettingsStore } from './settings'
import { exists, safeJoin, sameVolume } from './util/paths'

export interface CoreOptions {
  userData: string
  openUrl: (url: string) => Promise<void>
  emit: (event: CoreEvent, payload: unknown) => void
  appVersion?: string
  crypto?: Crypto // Electron safeStorage; ohne kann kein Nexus-Key gespeichert werden
  protocol?: ProtocolControl | null // nxm:// registrieren
  fetchImpl?: typeof fetch
  netTuning?: NetTuning // nur Tests: kurze Zeitlimits und Pausen
  gameRunning?: () => Promise<boolean> // Standard: Prozessliste (tasklist)
  locate?: LocateSources // nur Tests: eigene Steam/GOG/Epic-Quellen statt Registry
  dataRootFor?: (gameRoot: string | null) => string // nur Tests: Standard-Datenordner
  systemLocales?: () => readonly string[] // Windows-Sprachen (app.getPreferredSystemLanguages), für Sprache "auto"
  autoDelayMs?: number // nur Tests: Wartezeit, bis automatisch installierte Mods gesammelt eingespielt werden
}

const AUTO_DELAY = 2500 // Collections: viele Mods kurz nacheinander, einmal einspielen statt nach jedem
const AUTO_MAX_WAIT = 60_000
const AUTO_RETRY = 60_000 // Einspielen gescheitert (Spiel läuft): so lange bis zum nächsten Versuch
const OPEN_BATCH = 5 // ohne Premium: so viele Nexus-Seiten auf einmal öffnen
const MAX_PLANS = 6
const SHARD_MAX_BYTES = 8 * 1024 * 1024

/** Nichts zu entscheiden: eine Fassung, alles bekannt, nichts gesperrt, Ersetzen (falls) sicher. */
const isClean = (p: ImportPreview): boolean =>
  p.variants.length === 0 && p.unknown.length === 0 && p.blocked.length === 0 && p.mapped.length > 0 && (!p.replaces || p.replaceDefault)

const NO_CRYPTO: Crypto = {
  available: () => false,
  encrypt: () => {
    throw new Error('keine Verschlüsselung')
  },
  decrypt: () => {
    throw new Error('keine Verschlüsselung')
  },
}

const mergeReports = (a: ApplyReport, b: ApplyReport): ApplyReport => ({
  linked: a.linked + b.linked,
  copied: a.copied + b.copied,
  removed: a.removed + b.removed,
  backedUp: a.backedUp + b.backedUp,
  restored: a.restored + b.restored,
  drift: [...a.drift, ...b.drift],
  blocked: [...new Set([...a.blocked, ...b.blocked])],
  errors: [...a.errors, ...b.errors],
})

/** Hält alle Teile zusammen. Kennt Electron nicht, damit es sich auch in Tests starten lässt. */
export class Core {
  readonly settings: SettingsStore
  game!: GameInfo
  dataRoot = ''
  journal!: Journal
  mods!: ModStore
  profiles!: ProfileStore
  deployer: Deployer | null = null
  snapshot: Snapshot | null = null
  readonly watcher: GameWatcher
  nexus!: NexusService
  private queue: Promise<unknown> = Promise.resolve()
  // Imports, die fertig werden, bevor die Oberfläche zuhört (z. B. App per nxm-Klick gestartet)
  private uiReady = false
  private importBuffer: ImportPreview[] = []
  private planBuffer: ModPlan[] = []
  private readonly plans = new Map<string, StoredPlan>()
  // Ohne Dialog installierte Mods: werden gesammelt einmal eingespielt
  private autoBatch: string[] = []
  private autoTimer: ReturnType<typeof setTimeout> | null = null
  private autoSince: number | null = null
  private autoWarned = false
  private readonly autoReqIds = new Set<number>() // Requirements dieser Mods nach dem Einspielen gebündelt auffrischen
  private readonly importing = new Set<string>() // Archive zwischen Download-Ende und Dialog

  constructor(private readonly o: CoreOptions) {
    this.settings = new SettingsStore(path.join(o.userData, 'settings.json'))
    this.watcher = new GameWatcher((s) => {
      o.emit('game-state', s)
      // Spiel beendet: wartende Auto-Installs jetzt einspielen
      if (s.phase === 'exited' && this.autoBatch.length) this.scheduleAutoApply()
    })
  }

  get snapshotFile(): string {
    return path.join(this.dataRoot, 'snapshot-vanilla.json')
  }
  get vanillaCacheDir(): string {
    return path.join(this.dataRoot, 'backups', 'vanilla')
  }

  private defaultData(gameRoot: string | null): string {
    return this.o.dataRootFor ? this.o.dataRootFor(gameRoot) : defaultDataRoot(gameRoot, this.o.userData)
  }

  async init(): Promise<void> {
    const s = await this.settings.load()
    this.useLanguage()
    this.game = await locateGame(s.gameRoot, s.lastBuild, this.o.locate)
    this.dataRoot = s.dataRoot ?? this.defaultData(this.game.found ? this.game.root : null)
    // Einmal gefunden, bleibt der Datenordner fest. Sonst landet ein Start ohne Spiel (Laufwerk fehlt) in einem
    // leeren Ersatzordner und alle Mods scheinen weg.
    if (!s.dataRoot && this.game.found) await this.settings.patch({ dataRoot: this.dataRoot })
    this.journal = new Journal(path.join(this.dataRoot, 'journal'))
    this.mods = new ModStore(this.dataRoot)
    await this.mods.load()
    this.profiles = new ProfileStore(this.dataRoot)
    await this.profiles.load()
    if (this.profiles.sync(this.mods.list().map((m) => m.id))) await this.profiles.save()
    this.snapshot = await loadSnapshot(this.snapshotFile)
    if (this.game.found) {
      this.deployer = new Deployer(this.game.root, this.dataRoot, this.journal)
      await this.deployer.load()
      await this.settings.patch({ lastBuild: this.game.build })
    }
    this.nexus = new NexusService({
      userData: this.o.userData,
      dataRoot: this.dataRoot,
      appVersion: this.o.appVersion ?? '0.0.0',
      crypto: this.o.crypto ?? NO_CRYPTO,
      protocol: this.o.protocol ?? null,
      emitDownloads: (items) => this.o.emit('downloads', items),
      emitStatus: () => this.o.emit('nexus', null),
      onDownloaded: (file, meta) => this.importDownloaded(file, meta),
      onRecovered: () => void this.updateIfStale(),
      fetchImpl: this.o.fetchImpl,
      tuning: this.o.netTuning,
    })
    await this.nexus.init()
    await this.watcher.check()
  }

  /** Nach dem Start im Hintergrund (nie vor dem Fenster): Konto prüfen, dann Updates, wenn der letzte Check alt ist. */
  async backgroundNexus(): Promise<void> {
    if (!this.nexus.keys.key) return
    void this.nexus.refreshHealth()
    void this.refreshRequirements()
    if (await this.nexus.validate()) await this.updateIfStale()
  }

  /** Requirements der Nexus-Mods im Cache auffrischen (nur alte/fehlende). Fehler: beim nächsten Mal. */
  private async refreshRequirements(ids?: number[]): Promise<void> {
    const all = ids ?? this.mods.list().flatMap((m) => (m.source.nexusModId !== undefined ? [m.source.nexusModId] : []))
    if (!all.length) return
    try {
      await this.nexus.reqs.ensure(this.nexus.client, all)
      this.o.emit('inventory', null)
    } catch {
      // Nexus gestört: der Cache bleibt, wie er ist
    }
  }

  private async updateIfStale(): Promise<void> {
    if (this.nexus.stale && this.mods.list().some((m) => m.source.nexusModId !== undefined)) {
      await this.nexus.checkUpdates(this.mods.list()).catch(() => undefined)
      this.o.emit('inventory', null)
    }
  }

  private notify(n: Notice): void {
    this.o.emit('notify', n)
  }

  private pushImports(previews: ImportPreview[]): void {
    if (this.uiReady) this.o.emit('imports', previews)
    else this.importBuffer.push(...previews)
  }

  /** Oberfläche ist bereit: gepufferte Imports abholen. */
  pendingImports(): ImportPreview[] {
    this.uiReady = true
    const out = this.importBuffer
    this.importBuffer = []
    return out
  }

  /**
   * Download fertig: entpacken und den Dialog zeigen. Kommt er aus einer Collection oder als Requirement
   * (oder ist Schnell-Installieren an) und gibt es nichts zu entscheiden, wird gleich installiert.
   */
  private async importDownloaded(file: string, meta: NexusMeta): Promise<void> {
    // Bis der Dialog offen ist (dann schützt pendingInputs), darf "Ungenutzte löschen" das Archiv nicht anfassen
    const key = path.basename(file).toLowerCase()
    this.importing.add(key)
    try {
      let preview: ImportPreview
      try {
        preview = await this.exclusive(t('main.busy.unpack'), () => this.mods.prepare(file, meta))
      } catch (err) {
        this.notify({ tone: 'alert', title: t('main.import.failedTitle'), body: `${meta.modName}: ${(err as Error).message}` })
        return
      }
      if ((meta.auto || this.settings.settings.quickInstall) && isClean(preview)) {
        const decision = { token: preview.token, unknown: 'skip' as const, replace: preview.replaceDefault, replaces: preview.replaces }
        const out = await this.commit(decision, true)
        if (out.ok) {
          this.autoBatch.push(out.mod.name)
          this.scheduleAutoApply()
          return
        }
        this.notify({ tone: 'alert', title: t('main.import.failedTitle'), body: `${meta.modName}: ${out.error}` })
        // Noch nicht verbraucht (z. B. Platte voll beim Staging)? Dann von Hand im Dialog
        if (!this.mods.hasPending(preview.token)) return
      }
      this.pushImports([preview])
    } finally {
      this.importing.delete(key)
    }
  }

  /**
   * Einspielen, wenn kein Auto-Download mehr läuft (eine Collection kommt Datei für Datei, einmal am Ende
   * reicht). Bei langen Listen spätestens nach AUTO_MAX_WAIT, damit man den Fortschritt im Spiel hat.
   */
  private scheduleAutoApply(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer)
    this.autoSince ??= Date.now()
    const delay = this.o.autoDelayMs ?? AUTO_DELAY
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null
      const more = this.nexus.queue.items.some((d) => d.auto && (d.state === 'queued' || d.state === 'preparing' || d.state === 'downloading'))
      if (more && Date.now() - (this.autoSince ?? 0) < AUTO_MAX_WAIT) return this.scheduleAutoApply()
      void this.flushAuto()
    }, Math.max(delay, 20))
    this.autoTimer.unref?.()
  }

  /**
   * Gesammelt installierte Mods einmal einspielen und eine Meldung für alle. Klappt es nicht (Spiel läuft),
   * bleiben sie gesammelt: neuer Versuch nach AUTO_RETRY bzw. sobald das Spiel beendet ist; gewarnt wird einmal.
   */
  private async flushAuto(): Promise<void> {
    const names = this.autoBatch.splice(0)
    this.autoSince = null
    if (!names.length) return
    const reqIds = [...this.autoReqIds]
    this.autoReqIds.clear()
    if (reqIds.length) void this.refreshRequirements(reqIds)
    const list = names.slice(0, 3).join(', ') + (names.length > 3 ? ` ${t('main.deploy.more', names.length - 3)}` : '')
    try {
      const report = await this.exclusive(t('main.busy.deploy'), () => (this.deployer ? this.applyNow() : Promise.resolve(emptyReport())))
      this.warnApply(report)
      this.autoWarned = false
      this.notify({ tone: 'ok', title: t('main.auto.title'), body: t('main.auto.installed', names.length, list) })
    } catch (err) {
      // Installiert und aktiv sind sie; eingespielt wird beim nächsten Versuch (oder Schalter/LAUNCH)
      this.autoBatch.unshift(...names)
      if (!this.autoWarned) {
        this.autoWarned = true
        this.notify({ tone: 'warn', title: t('main.auto.title'), body: t('main.auto.deployLater', names.length, (err as Error).message) })
      }
      if (!this.autoTimer) {
        this.autoTimer = setTimeout(() => {
          this.autoTimer = null
          void this.flushAuto()
        }, this.o.autoDelayMs !== undefined ? Math.max(this.o.autoDelayMs, 20) : AUTO_RETRY)
        this.autoTimer.unref?.()
      }
    }
    this.o.emit('inventory', null)
  }

  private pushPlan(plan: ModPlan): void {
    if (this.uiReady) this.o.emit('plan', plan)
    else this.planBuffer.push(plan)
  }

  /** Collections aus nxm-Klicks, die vor der Oberfläche fertig wurden. */
  pendingPlans(): ModPlan[] {
    const out = this.planBuffer
    this.planBuffer = []
    return out
  }

  /** .rdshard per Doppelklick (Kommandozeile): als Plan in SHARDS öffnen; Fehler als Meldung. */
  async openShardPath(file: string): Promise<void> {
    try {
      this.pushPlan(await this.readShardFile(file))
    } catch (err) {
      this.notify({ tone: 'alert', title: 'SHARD', body: (err as Error).message })
    }
  }

  /** Klick auf "Mod Manager Download" (nxm://…). Fehler kommen als Meldung, nicht als Ausnahme. */
  async handleNxm(url: string): Promise<void> {
    // Collection-Knopf auf der Website: nxm://cyberpunk2077/collections/<slug>/revisions/<n>
    if (/^nxm:\/\/[^/]+\/collections\//i.test(url.trim())) {
      try {
        this.pushPlan(await this.loadCollection(url))
      } catch (err) {
        this.notify({ tone: 'alert', title: 'COLLECTION', body: (err as Error).message })
      }
      return
    }
    try {
      const item = await this.nexus.handleNxm(url)
      this.notify({ tone: 'info', title: 'DOWNLOAD', body: t('main.download.queued', withVersion(item.name, item.version)) })
    } catch (err) {
      this.notify({ tone: 'alert', title: 'NEXUS', body: (err as Error).message })
    }
  }

  nexusStatus(): NexusStatus {
    return this.nexus.status()
  }

  async checkUpdates(): Promise<Record<string, UpdateInfo>> {
    const res = await this.nexus.checkUpdates(this.mods.list())
    this.o.emit('inventory', null)
    return res
  }

  async downloadUpdate(recordId: string) {
    const u = this.nexus.updates[recordId]
    if (!u?.hasUpdate || !u.latestFileId) throw new Error(t('main.update.noneKnown'))
    return this.nexus.downloadFile(u.nexusModId, u.latestFileId, recordId)
  }

  /** Alle verändernden Aktionen laufen nacheinander. */
  private exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.o.emit('busy', label)
      try {
        return await fn()
      } finally {
        this.o.emit('busy', null)
      }
    })
    this.queue = next.catch(() => undefined)
    return next
  }

  private needDeployer(): Deployer {
    if (!this.deployer) throw new Error(this.game.error ?? t('main.game.notFound'))
    return this.deployer
  }

  private plan(): Plan {
    const d = this.needDeployer()
    return planDeployment(this.mods.list(), this.profiles.profile, this.mods.stagedPath, (active) => d.overwriteFor(active))
  }

  /** Frameworks, deren Marker-Dateien gerade im Spielordner liegen (egal, wer sie installiert hat). */
  async installedFrameworks(): Promise<FrameworkId[]> {
    if (!this.game.found) return []
    const out: FrameworkId[] = []
    for (const f of FRAMEWORKS) {
      for (const m of f.markers) {
        if (await exists(safeJoin(this.game.root, m))) {
          out.push(f.id)
          break
        }
      }
    }
    return out
  }

  /** Läuft das Spiel? Nicht nur der Watcher (der beobachtet nur nach einem eigenen Start), sondern die Prozessliste. */
  private async assertNotRunning(): Promise<void> {
    const running = this.watcher.running || (await (this.o.gameRunning ?? (async () => (await gamePid()) !== null))())
    if (running) throw new Error(t('main.game.running'))
  }

  /** Build frisch von der exe: Steam kann das Spiel aktualisieren, während RIPPERDOC offen ist. */
  private async freshBuild(): Promise<string> {
    try {
      return (await readPeVersion(safeJoin(this.game.root, GAME_EXE_REL))).file || this.game.build
    } catch {
      return this.game.build
    }
  }

  /** Fehler beim Einspielen melden, statt sie im Bericht verschwinden zu lassen. */
  private warnApply(report: ApplyReport): void {
    if (!report.errors.length) return
    const more = report.errors.length > 3 ? ` · ${t('main.deploy.more', report.errors.length - 3)}` : ''
    this.notify({ tone: 'alert', title: t('main.deploy.problemsTitle'), body: report.errors.slice(0, 3).join(' · ') + more })
  }

  /** Wartet, bis keine verändernde Aktion mehr läuft (vor dem Beenden); gesammelte Installationen erst einspielen. */
  async idle(): Promise<void> {
    if (this.autoTimer) {
      clearTimeout(this.autoTimer)
      this.autoTimer = null
      await this.flushAuto()
    }
    return this.queue.then(() => undefined)
  }

  private async applyNow(): Promise<ApplyReport> {
    const d = this.needDeployer()
    // VANILLA MODE: Schalter ändern nur die Auswahl, der Spielordner bleibt unberührt (geht auch bei laufendem Spiel)
    if (d.manifest.suspended) {
      // Nichts von uns liegt im Spiel: ausgemusterte Mods können weg
      await this.mods.purgeRetired()
      return emptyReport()
    }
    await this.assertNotRunning()
    let plan = this.plan()
    if (!this.snapshot && plan.desired.size > 0) {
      this.o.emit('busy', 'VANILLA SNAPSHOT')
      await this.journal.write({ op: 'snapshot', note: this.game.build })
      this.snapshot = await takeSnapshot(this.game.root, this.game.build, this.vanillaCacheDir)
      await saveSnapshot(this.snapshotFile, this.snapshot)
    }
    let report = await d.apply(plan.desired)
    if (report.drift.length) {
      // Gerettete Dateien gleich wieder an ihren Platz (jetzt aus overwrite/)
      plan = this.plan()
      report = mergeReports(report, await d.apply(plan.desired))
    }
    if (this.snapshot && !(await this.installedFrameworks()).includes('redscript')) {
      await d.restoreCache(this.snapshot, this.vanillaCacheDir, await this.freshBuild(), report)
    }
    // Durch Updates ersetzte Mods hängen jetzt nicht mehr im Spielordner
    await this.mods.purgeRetired()
    return report
  }

  /** Ist ein Nexus-Mod da? Als installierter Mod (an/aus) oder als Framework, das sonst wer mitbringt. */
  private reqState(nexusModId: number, installed: FrameworkId[]): Pick<NexusRequirement, 'state' | 'recordId'> {
    const enabled = this.profiles.profile.enabled
    const recs = this.mods.list().filter((m) => m.source.nexusModId === nexusModId)
    const on = recs.find((m) => enabled[m.id])
    if (on) return { state: 'ok', recordId: on.id }
    const fw = FRAMEWORKS.find((f) => f.nexusId === nexusModId)
    if (fw && (installed.includes(fw.id) || this.mods.list().some((m) => enabled[m.id] && m.provides.includes(fw.id)))) return { state: 'ok' }
    if (recs.length) return { state: 'off', recordId: recs[0].id }
    return { state: 'missing' }
  }

  /** Requirements eines Nexus-Mods laut Nexus, mit Abgleich. Nexus nicht erreichbar: alter Cache, falls da. */
  async requirements(nexusModId: number, refresh = false): Promise<NexusRequirement[]> {
    try {
      // Jemand wartet im Dialog/Detail darauf: kurz fragen, sonst alter Cache (unten)
      await this.nexus.reqs.ensure(this.nexus.client, [nexusModId], refresh, true)
    } catch (err) {
      if (!this.nexus.reqs.get(nexusModId)) throw err
    }
    const installed = await this.installedFrameworks()
    return (this.nexus.reqs.get(nexusModId) ?? [])
      .filter((r) => r.modId !== nexusModId)
      .map((r) => ({ ...r, optional: isOptionalNote(r.notes), ...this.reqState(r.modId, installed) }))
  }

  /**
   * Fehlende Requirements holen: mit Premium direkt die Hauptdatei (installiert sich ohne Dialog, wenn klar),
   * sonst die Nexus-Seite öffnen; der Klick auf „Mod Manager Download“ dort landet dann wieder hier.
   */
  async fetchRequirements(list: { modId: number; name: string }[], parent: string): Promise<FetchRun> {
    const run: FetchRun = { queued: [], opened: 0, left: 0, failed: [] }
    const tags: DownloadTags = { auto: true, origin: { kind: 'requirement', title: parent } }
    for (const r of list) {
      if (this.nexus.user?.premium) {
        try {
          run.queued.push(await this.nexus.downloadMain(r.modId, tags))
          continue
        } catch (err) {
          // Mehrere Hauptdateien: dann eben auf Nexus wählen
          if (!(err instanceof NexusError && err.status === 409)) {
            run.failed.push({ name: r.name, error: (err as Error).message })
            continue
          }
        }
      }
      // Nicht beliebig viele Browser-Tabs auf einmal; der Rest kommt beim nächsten Klick
      if (run.opened >= OPEN_BATCH * 2) {
        run.left++
        continue
      }
      this.nexus.expect(r.modId, 0, tags)
      await this.o.openUrl(fileUrl(r.modId, 0))
      run.opened++
    }
    return run
  }

  async inventory(): Promise<InventoryView> {
    const installed = await this.installedFrameworks()
    const plan = this.deployer ? this.plan() : null
    const missing: MissingDep[] = []
    const missingNexus: MissingNexus[] = []
    for (const m of this.mods.list()) {
      if (!this.profiles.profile.enabled[m.id]) continue
      for (const r of m.requires) if (!installed.includes(r)) missing.push({ modId: m.id, framework: r })
      const own = m.source.nexusModId
      for (const r of own !== undefined ? (this.nexus?.reqs.get(own) ?? []) : []) {
        if (r.modId === own || isOptionalNote(r.notes)) continue
        const st = this.reqState(r.modId, installed)
        if (st.state !== 'ok') missingNexus.push({ modId: m.id, nexusModId: r.modId, name: r.name, off: st.state === 'off' })
      }
    }
    const files = Object.values(this.deployer?.manifest.files ?? {})
    return {
      mods: this.mods.list(),
      profile: this.profiles.profile,
      conflicts: plan?.conflicts ?? [],
      missing,
      deploy: {
        deployed: files.length,
        mode: files.some((f) => f.mode === 'copy') ? 'copy' : 'hardlink',
        lastApply: this.deployer?.manifest.lastApply ?? null,
        snapshot: !!this.snapshot,
        suspended: this.deployer?.manifest.suspended ?? false,
      },
      installedFrameworks: installed,
      updates: Object.fromEntries(Object.entries(this.nexus?.updates ?? {}).filter(([id]) => this.mods.mods.has(id))),
      missingNexus,
    }
  }

  async prepare(paths: string[]): Promise<{ previews: ImportPreview[]; failures: ImportFailure[] }> {
    const previews: ImportPreview[] = []
    const failures: ImportFailure[] = []
    await this.exclusive(t('main.busy.unpack'), async () => {
      for (const p of paths) {
        try {
          previews.push(await this.mods.prepare(p))
        } catch (err) {
          failures.push({ input: p, error: (err as Error).message })
        }
      }
    })
    return { previews, failures }
  }

  chooseVariant(token: string, variant: string): Promise<ImportPreview> {
    return this.mods.chooseVariant(token, variant)
  }

  cancelImport(token: string): Promise<void> {
    return this.mods.cancel(token)
  }

  commitImport(decision: ImportDecision): Promise<ImportOutcome> {
    return this.commit(decision, false)
  }

  /**
   * defer: nur ins Staging und aktiv schalten, eingespielt wird gesammelt (flushAuto). Der Spielordner bleibt
   * bis dahin unberührt, daher geht das auch bei laufendem Spiel.
   */
  private commit(decision: ImportDecision, defer: boolean): Promise<ImportOutcome> {
    return this.exclusive(t('main.busy.install'), async () => {
      try {
        // Vorher prüfen, nicht erst nach dem Staging (sonst halb installiert und Import verbraucht)
        if (!defer && this.deployer && !this.deployer.manifest.suspended) await this.assertNotRunning()
        const { mod, replaced } = await this.mods.commit(decision)
        if (replaced) this.profiles.replace(replaced.id, mod.id)
        else this.profiles.add(mod.id, true)
        await this.profiles.save()
        // Update: gerettete Einstellungen und angelegte Ordner des alten Mods gehören jetzt dem neuen
        if (replaced && this.deployer) {
          this.deployer.reassign(replaced.id, mod.id)
          await this.deployer.save()
        }
        let applied = emptyReport()
        let deployed = false
        try {
          if (this.deployer && !defer) {
            applied = await this.applyNow()
            deployed = true
          }
        } catch (err) {
          // Der Mod ist installiert und aktiv; das Einspielen holt der nächste Deploy nach
          applied.errors.push(t('main.import.deployFailed', (err as Error).message))
        }
        if (replaced) {
          // Erst löschen, wenn seine Dateien sicher nicht mehr im Spielordner hängen (sonst nach dem nächsten Einspielen)
          await this.mods.retire(replaced.id)
          if (deployed || !this.deployer) await this.mods.purgeRetired()
          await this.nexus.forget(replaced.id)
        }
        await this.journal.write({ op: 'install', mod: mod.id, note: replaced ? t('main.journal.replaced', replaced.id) : mod.name })
        this.o.emit('inventory', null)
        if (mod.source.nexusModId !== undefined && this.nexus.keys.key) {
          // Gesammelt nach dem Einspielen statt einmal je Mod einer Collection
          if (defer) this.autoReqIds.add(mod.source.nexusModId)
          else void this.refreshRequirements([mod.source.nexusModId])
        }
        return { ok: true as const, mod, applied }
      } catch (err) {
        return { ok: false as const, error: (err as Error).message }
      }
    })
  }

  setEnabled(id: string, on: boolean): Promise<InventoryView> {
    return this.exclusive(on ? t('main.busy.enable') : t('main.busy.disable'), async () => {
      const before = this.profiles.profile.enabled[id]
      this.profiles.setEnabled(id, on)
      try {
        this.warnApply(await this.applyNow())
      } catch (err) {
        this.profiles.setEnabled(id, before ?? false)
        throw err
      }
      await this.profiles.save()
      await this.journal.write({ op: on ? 'enable' : 'disable', mod: id })
      return this.inventory()
    })
  }

  move(id: string, toIndex: number): Promise<InventoryView> {
    return this.exclusive(t('main.busy.order'), async () => {
      const before = [...this.profiles.profile.order]
      this.profiles.move(id, toIndex)
      try {
        this.warnApply(await this.applyNow())
      } catch (err) {
        this.profiles.profile.order = before
        throw err
      }
      await this.profiles.save()
      await this.journal.write({ op: 'move', mod: id, note: t('main.journal.position', toIndex + 1) })
      return this.inventory()
    })
  }

  removeMod(id: string): Promise<InventoryView> {
    return this.exclusive(t('main.busy.remove'), async () => {
      const before = this.profiles.profile.enabled[id]
      this.profiles.setEnabled(id, false)
      if (this.deployer) {
        try {
          this.warnApply(await this.applyNow())
        } catch (err) {
          this.profiles.setEnabled(id, before ?? false)
          throw err
        }
        await this.deployer.adoptDirs(id)
      }
      await this.journal.write({ op: 'uninstall', mod: id })
      await this.mods.remove(id)
      await this.nexus.forget(id)
      this.profiles.sync(this.mods.list().map((m) => m.id))
      await this.profiles.save()
      return this.inventory()
    })
  }

  /** Mehrere Mods auf einmal an/aus: ein Einspielen statt eines je Mod. */
  setEnabledMany(ids: string[], on: boolean): Promise<InventoryView> {
    return this.exclusive(on ? t('main.busy.enable') : t('main.busy.disable'), async () => {
      const list = [...new Set(ids)].filter((id) => this.mods.mods.has(id) && !!this.profiles.profile.enabled[id] !== on)
      // Nichts zu ändern: nicht einspielen (würde bei laufendem Spiel grundlos scheitern)
      if (!list.length) return this.inventory()
      const before = new Map(list.map((id) => [id, this.profiles.profile.enabled[id] ?? false]))
      for (const id of list) this.profiles.setEnabled(id, on)
      try {
        this.warnApply(await this.applyNow())
      } catch (err) {
        for (const [id, was] of before) this.profiles.setEnabled(id, was)
        throw err
      }
      await this.profiles.save()
      for (const id of list) await this.journal.write({ op: on ? 'enable' : 'disable', mod: id })
      return this.inventory()
    })
  }

  /** Mehrere Mods entfernen: erst alle aus dem Spielordner (ein Einspielen), dann die Staging-Ordner löschen. */
  removeMany(ids: string[]): Promise<InventoryView> {
    return this.exclusive(t('main.busy.remove'), async () => {
      const list = [...new Set(ids)].filter((id) => this.mods.mods.has(id))
      const before = new Map(list.map((id) => [id, this.profiles.profile.enabled[id] ?? false]))
      for (const id of list) this.profiles.setEnabled(id, false)
      if (this.deployer) {
        try {
          this.warnApply(await this.applyNow())
        } catch (err) {
          for (const [id, was] of before) this.profiles.setEnabled(id, was)
          throw err
        }
        for (const id of list) await this.deployer.adoptDirs(id)
      }
      for (const id of list) {
        await this.journal.write({ op: 'uninstall', mod: id })
        await this.mods.remove(id)
        await this.nexus.forget(id)
      }
      this.profiles.sync(this.mods.list().map((m) => m.id))
      await this.profiles.save()
      return this.inventory()
    })
  }

  // ---------- Collections und Shards ----------

  private storePlan(p: StoredPlan): ModPlan {
    this.plans.set(p.id, p)
    // Nur die letzten paar behalten; die Oberfläche zeigt ohnehin einen
    for (const id of [...this.plans.keys()].slice(0, Math.max(0, this.plans.size - MAX_PLANS))) this.plans.delete(id)
    return this.planView(p.id)!
  }

  private newPlanId(): string {
    return randomBytes(5).toString('hex')
  }

  /** Plan mit frischem Abgleich gegen Inventar und Downloads; null = nicht (mehr) da. */
  planView(id: string): ModPlan | null {
    const p = this.plans.get(id)
    return p ? resolvePlan(p, this.mods.list(), this.nexus.queue.items, this.mods.pendingNexus()) : null
  }

  closePlan(id: string): void {
    this.plans.delete(id)
    // Noch nicht angekommene nxm-Klicks aus diesem Plan nicht mehr automatisch installieren
    this.nexus.forgetExpected(id)
  }

  /** Collection von Nexus: Link, nxm-Link oder Kurzname. Braucht keinen Key. */
  async loadCollection(input: string): Promise<ModPlan> {
    const ref = parseCollectionRef(input)
    if (!ref) throw new Error(t('main.plan.badCollection'))
    if (ref.game !== NEXUS_GAME) throw new Error(t('main.nexus.wrongGame', ref.game))
    const c = await fetchCollection(this.nexus.client, ref.slug, ref.revision)
    return this.storePlan(collectionPlan(c, this.newPlanId()))
  }

  /** Shard aus Code oder Dateiinhalt. Bilder/Autoren holt eine Abfrage bei Nexus; ohne Netz geht es auch. */
  async readShard(text: string): Promise<ModPlan> {
    const shard = decodeShard(text)
    let briefs = new Map<number, ModBrief>()
    try {
      // Kurz fragen (ohne Wiederholung): bei einer Nexus-Störung soll das Öffnen nicht eine Minute hängen
      briefs = await fetchModBriefs(this.nexus.client, shard.mods.map((m) => m.modId), true)
    } catch {
      // Nexus nicht erreichbar: Plan ohne Bilder, Verfügbarkeit zeigt sich beim Laden
    }
    return this.storePlan(shardPlan(shard, this.newPlanId(), briefs))
  }

  async readShardFile(file: string): Promise<ModPlan> {
    // Nur lokale Dateien (kein \\server\…): Pfade kommen aus der Oberfläche, vom Drop oder aus der Kommandozeile
    if (!/^[a-z]:[\\/]/i.test(file)) throw new Error(t('main.shard.unreadable'))
    const st = await fs.stat(file)
    if (st.size > SHARD_MAX_BYTES) throw new Error(t('main.shard.unreadable'))
    return this.readShard(await fs.readFile(file, 'utf8'))
  }

  /**
   * Ausgewählte Einträge holen. Premium: alles in die Download-Liste, installiert sich ohne Dialog, wenn klar.
   * Ohne Premium verlangt Nexus je Datei einen Klick auf der Website: die nächsten Seiten öffnen (force: diese
   * Einträge auch dann, wenn sie schon einmal offen waren).
   */
  async planDownload(id: string, keys: string[], force = false): Promise<FetchRun> {
    const plan = this.planView(id)
    const stored = this.plans.get(id)
    if (!plan || !stored) throw new Error(t('main.plan.gone'))
    if (!this.nexus.keys.key) throw new Error(t('main.nexus.keyFirstUplink'))
    const want = new Set(keys)
    const todo = plan.entries.filter(
      (e) => want.has(e.key) && (e.state === 'missing' || e.state === 'update' || e.state === 'older') && (!e.download || e.download.state === 'error'),
    )
    const origin = { kind: plan.kind, title: plan.title }
    // Ältere oder gleich alte Datei: nur auf ausdrücklichen Wunsch, und dann mit Dialog (nie still ersetzen)
    const tagsFor = (e: PlanEntry): DownloadTags => ({ auto: e.state !== 'older', origin })
    const run: FetchRun = { queued: [], opened: 0, left: 0, failed: [] }
    if (this.nexus.user?.premium) {
      for (const e of todo) {
        try {
          if (e.download?.state === 'error') run.queued.push(this.nexus.queue.retry(e.download.id))
          else if (e.fileId > 0) run.queued.push(await this.nexus.downloadFile(e.modId, e.fileId, e.state === 'update' ? e.recordId : undefined, tagsFor(e)))
          else run.queued.push(await this.nexus.downloadMain(e.modId, tagsFor(e)))
        } catch (err) {
          run.failed.push({ name: e.modName, error: (err as Error).message })
        }
      }
      return run
    }
    for (const e of todo) {
      if (!force && stored.opened.has(e.key) && e.download?.state !== 'error') continue
      if (run.opened >= OPEN_BATCH) {
        run.left++
        continue
      }
      this.nexus.expect(e.modId, e.fileId, tagsFor(e), id)
      await this.o.openUrl(fileUrl(e.modId, e.fileId))
      stored.opened.add(e.key)
      run.opened++
    }
    return run
  }

  /** Shard: Reihenfolge und Schalter des Absenders für die installierten Einträge übernehmen (oben = Priorität). */
  planApplyOrder(id: string): Promise<InventoryView> {
    return this.exclusive(t('main.busy.order'), async () => {
      const plan = this.planView(id)
      if (!plan) throw new Error(t('main.plan.gone'))
      const hits = plan.entries.filter((e) => e.state === 'installed' && e.recordId)
      const ids = [...new Set(hits.map((e) => e.recordId!))]
      const prof = this.profiles.profile
      const before = { order: [...prof.order], enabled: { ...prof.enabled } }
      prof.order = [...ids, ...prof.order.filter((x) => !ids.includes(x))]
      for (const e of hits) if (e.enabled !== undefined) this.profiles.setEnabled(e.recordId!, e.enabled)
      try {
        this.warnApply(await this.applyNow())
      } catch (err) {
        prof.order = before.order
        prof.enabled = before.enabled
        throw err
      }
      await this.profiles.save()
      await this.journal.write({ op: 'move', note: t('main.journal.shardOrder', plan.title) })
      return this.inventory()
    })
  }

  private shard(o: ShareOptions) {
    return shardFromInventory(this.mods.list(), this.profiles.profile, o.title, o.onlyActive, this.game.found ? this.game.patch : null)
  }

  /** Eigene Liste teilen: Code zum Einfügen + Text mit Nexus-Links. Enthält nur Verweise, keine Dateien. */
  shareExport(o: ShareOptions): ShareExport {
    const s = this.shard(o)
    return { code: encodeShard(s), text: shardText(s), nexus: s.mods.length, local: s.local.length }
  }

  /** Inhalt einer .rdshard-Datei. */
  shareFile(o: ShareOptions): string {
    return shardFile(this.shard(o))
  }

  // ---------- Downloads-Ordner ----------

  /** Archive in downloads/ und ob sie noch zu einem Mod, einem offenen Import oder einem Download gehören. */
  private async archives(): Promise<{ name: string; size: number; used: boolean }[]> {
    let names: string[] = []
    try {
      names = await fs.readdir(this.mods.downloadsDir)
    } catch {
      return []
    }
    const used = new Set(this.mods.list().map((m) => m.source.archive.toLowerCase()))
    for (const p of this.mods.pendingInputs()) used.add(path.basename(p).toLowerCase())
    for (const name of this.importing) used.add(name)
    for (const d of this.nexus.queue.items) {
      if (!d.fileName || d.state === 'canceled') continue
      used.add(d.fileName.toLowerCase())
      used.add(`${d.fileName}.part`.toLowerCase())
    }
    const out: { name: string; size: number; used: boolean }[] = []
    for (const name of names) {
      const st = await fs.stat(path.join(this.mods.downloadsDir, name)).catch(() => null)
      if (st?.isFile()) out.push({ name, size: st.size, used: used.has(name.toLowerCase()) })
    }
    return out
  }

  async downloadsUsage(): Promise<DownloadsUsage> {
    const list = await this.archives()
    const unused = list.filter((a) => !a.used)
    return {
      files: list.length,
      bytes: list.reduce((n, a) => n + a.size, 0),
      unused: unused.length,
      unusedBytes: unused.reduce((n, a) => n + a.size, 0),
    }
  }

  /** Archive löschen, die zu keinem installierten Mod mehr gehören (z. B. nach Entfernen oder Updates). */
  cleanDownloads(): Promise<DownloadsUsage> {
    return this.exclusive(t('main.busy.clean'), async () => {
      for (const a of await this.archives()) {
        if (a.used) continue
        await fs.rm(path.join(this.mods.downloadsDir, a.name), { force: true })
        await this.journal.write({ op: 'clean', note: a.name })
      }
      return this.downloadsUsage()
    })
  }

  async renameMod(id: string, name: string): Promise<InventoryView> {
    await this.mods.rename(id, name)
    return this.inventory()
  }

  /** Dateien, die gerade von RIPPERDOC im Spielordner liegen (0 = vanilla oder kein Spiel). */
  deployedFiles(): number {
    return this.deployer ? Object.keys(this.deployer.manifest.files).length : 0
  }

  purge(): Promise<PurgeReport> {
    return this.exclusive('PURGE', async () => {
      const d = this.needDeployer()
      await this.assertNotRunning()
      await this.journal.write({ op: 'purge' })
      const report = await d.purge()
      if (this.snapshot) await d.restoreCache(this.snapshot, this.vanillaCacheDir, await this.freshBuild(), report, true)
      const vanilla = this.snapshot ? await compareSnapshot(this.game.root, this.snapshot) : null
      // Auswahl bleibt erhalten; bis RE-DEPLOY bleibt der Spielordner vanilla
      d.manifest.suspended = true
      await d.save()
      this.o.emit('inventory', null)
      return { ...report, vanilla }
    })
  }

  redeploy(): Promise<ApplyReport> {
    return this.exclusive('RE-DEPLOY', async () => {
      const d = this.needDeployer()
      d.manifest.suspended = false
      let report: ApplyReport
      try {
        report = await this.applyNow()
      } catch (err) {
        // z. B. Spiel läuft: Spielordner ist weiter vanilla, also bleibt auch VANILLA MODE
        d.manifest.suspended = true
        await d.save()
        throw err
      }
      await this.journal.write({ op: 'redeploy' })
      this.warnApply(report)
      this.o.emit('inventory', null)
      return report
    })
  }

  async verify(): Promise<VerifyReport> {
    return this.needDeployer().verify(this.snapshot)
  }

  async launch(): Promise<void> {
    await this.exclusive('START', async () => {
      if (this.watcher.running) throw new Error(t('main.game.alreadyRunning'))
      this.warnApply(await this.applyNow())
      const s = this.settings.settings
      const hasRedmod = this.mods.list().some((m) => this.profiles.profile.enabled[m.id] && m.types.includes('redmod'))
      const args = [...(s.skipStartScreen ? ['-skipStartScreen'] : []), ...(hasRedmod ? ['-modded'] : [])]
      await this.journal.write({ op: 'launch', note: `${s.launchMode} ${args.join(' ')}`.trim() })
      // steam:// startet nur die Steam-Fassung; GOG und Epic immer über die exe
      const mode = this.game.store === 'gog' || this.game.store === 'epic' ? 'direct' : s.launchMode
      await launchGame({ gameRoot: this.game.root, mode, args, openUrl: this.o.openUrl })
      this.watcher.expect()
    })
  }

  async refreshGame(): Promise<GameInfo> {
    const s = this.settings.settings
    this.game = await locateGame(s.gameRoot, s.lastBuild, this.o.locate)
    if (this.game.found && !this.deployer) {
      this.deployer = new Deployer(this.game.root, this.dataRoot, this.journal)
      await this.deployer.load()
    }
    return this.game
  }

  /**
   * SYS.CONFIG: Spielordner von Hand wählen (null = wieder automatisch suchen). Liegt der Datenordner danach
   * woanders (erster Fund, noch keine Mods), meldet es restart: Die App startet dann einmal neu.
   */
  setGameRoot(picked: string | null): Promise<{ game: GameInfo; restart: boolean }> {
    return this.exclusive(t('main.busy.gameFolder'), async () => {
      const root = picked ? await normalizeGameRoot(picked) : null
      const s = this.settings.settings
      const next = await locateGame(root, s.lastBuild, this.o.locate)
      if (!next.found) throw new Error(next.error ?? t('main.game.cyberpunkNotFound'))
      const moved = !this.game.found || path.resolve(next.root).toLowerCase() !== path.resolve(this.game.root).toLowerCase()
      const m = this.deployer?.manifest
      if (moved && m && (Object.keys(m.files).length || Object.keys(m.backups).length)) {
        throw new Error(t('main.game.modsStillDeployed'))
      }
      await this.settings.patch({ gameRoot: root })
      await this.journal.write({ op: 'game', note: next.root })
      // Noch kein fester Datenordner: aufs Laufwerk des Spiels (Hardlinks), außer es liegen schon Mods im alten
      if (!s.dataRoot) {
        const dataRoot = this.mods.list().length ? this.dataRoot : this.defaultData(next.root)
        await this.settings.patch({ dataRoot })
        if (dataRoot !== this.dataRoot) {
          this.game = next
          return { game: next, restart: true }
        }
      }
      if (moved) {
        // Der Vanilla-Snapshot gehört zur alten Installation; beim nächsten Einbinden entsteht ein neuer
        if (await exists(this.snapshotFile)) await fs.rename(this.snapshotFile, this.snapshotFile.replace(/\.json$/, `.old-${Date.now()}.json`))
        this.snapshot = null
        this.deployer = new Deployer(next.root, this.dataRoot, this.journal)
        await this.deployer.load()
      }
      this.game = next
      await this.settings.patch({ lastBuild: next.build })
      return { game: next, restart: false }
    })
  }

  /** Nach einem Sprachwechsel: Meldungen aus dem Main-Prozess (auch die Spielsuche) in der neuen Sprache. */
  async applyLanguage(): Promise<void> {
    this.useLanguage()
    if (!this.game.found) await this.refreshGame()
  }

  private useLanguage(): void {
    const s = this.settings.settings.language
    // Ohne Windows-Sprachen (Tests) bleibt "auto" bei der aktuellen Sprache
    if (s !== 'auto' || this.o.systemLocales) setLang(resolveLang(s, this.o.systemLocales?.() ?? []))
  }

  appInfo(version: string, electron: string): AppInfo {
    return {
      version,
      electron,
      dataRoot: this.dataRoot,
      sameVolume: this.game.found ? sameVolume(this.game.root, this.dataRoot) : true,
      systemLang: resolveLang('auto', this.o.systemLocales?.() ?? []),
    }
  }
}
