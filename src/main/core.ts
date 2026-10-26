import { promises as fs } from 'node:fs'
import path from 'node:path'
import { GAME_EXE_REL, withVersion } from '@shared/brand'
import { FRAMEWORKS } from '@shared/frameworks'
import type { CoreEvent } from '@shared/api'
import { resolveLang, setLang, t } from '@shared/i18n'
import type {
  ApplyReport,
  AppInfo,
  FrameworkId,
  GameInfo,
  ImportDecision,
  ImportFailure,
  ImportOutcome,
  ImportPreview,
  InventoryView,
  MissingDep,
  NexusMeta,
  NexusStatus,
  Notice,
  PurgeReport,
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
import type { Crypto } from './nexus/keystore'
import { NexusService, type NetTuning, type ProtocolControl } from './nexus/service'
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
}

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

  constructor(private readonly o: CoreOptions) {
    this.settings = new SettingsStore(path.join(o.userData, 'settings.json'))
    this.watcher = new GameWatcher((s) => o.emit('game-state', s))
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
    if (await this.nexus.validate()) await this.updateIfStale()
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

  private async importDownloaded(file: string, meta: NexusMeta): Promise<void> {
    try {
      const preview = await this.exclusive(t('main.busy.unpack'), () => this.mods.prepare(file, meta))
      this.pushImports([preview])
    } catch (err) {
      this.notify({ tone: 'alert', title: t('main.import.failedTitle'), body: `${meta.modName}: ${(err as Error).message}` })
    }
  }

  /** Klick auf "Mod Manager Download" (nxm://…). Fehler kommen als Meldung, nicht als Ausnahme. */
  async handleNxm(url: string): Promise<void> {
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

  /** Wartet, bis keine verändernde Aktion mehr läuft (vor dem Beenden). */
  idle(): Promise<void> {
    return this.queue.then(() => undefined)
  }

  private async applyNow(): Promise<ApplyReport> {
    const d = this.needDeployer()
    // VANILLA MODE: Schalter ändern nur die Auswahl, der Spielordner bleibt unberührt (geht auch bei laufendem Spiel)
    if (d.manifest.suspended) return emptyReport()
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
    return report
  }

  async inventory(): Promise<InventoryView> {
    const installed = await this.installedFrameworks()
    const plan = this.deployer ? this.plan() : null
    const missing: MissingDep[] = []
    for (const m of this.mods.list()) {
      if (!this.profiles.profile.enabled[m.id]) continue
      for (const r of m.requires) if (!installed.includes(r)) missing.push({ modId: m.id, framework: r })
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
    return this.exclusive(t('main.busy.install'), async () => {
      try {
        // Vorher prüfen, nicht erst nach dem Staging (sonst halb installiert und Import verbraucht)
        if (this.deployer && !this.deployer.manifest.suspended) await this.assertNotRunning()
        const { mod, replaced } = await this.mods.commit(decision)
        if (replaced) this.profiles.replace(replaced.id, mod.id)
        else this.profiles.add(mod.id, true)
        await this.profiles.save()
        // Update: gerettete Einstellungen und angelegte Ordner des alten Mods gehören jetzt dem neuen
        if (replaced) this.deployer?.reassign(replaced.id, mod.id)
        let applied = emptyReport()
        try {
          if (this.deployer) applied = await this.applyNow()
        } catch (err) {
          // Der Mod ist installiert und aktiv; das Einspielen holt der nächste Deploy nach
          applied.errors.push(t('main.import.deployFailed', (err as Error).message))
        }
        if (replaced) {
          await this.mods.remove(replaced.id)
          await this.nexus.forget(replaced.id)
        }
        await this.journal.write({ op: 'install', mod: mod.id, note: replaced ? t('main.journal.replaced', replaced.id) : mod.name })
        this.o.emit('inventory', null)
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
