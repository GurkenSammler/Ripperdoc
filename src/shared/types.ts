// Gemeinsame Typen für Main-Prozess, Preload und Oberfläche.
// Pfade relativ zur Spielwurzel werden immer mit "/" geschrieben ("archive/pc/mod/x.archive").

import type { Lang, LangSetting } from './i18n/area'

export type FrameworkId =
  | 'cet'
  | 'red4ext'
  | 'redscript'
  | 'archivexl'
  | 'tweakxl'
  | 'codeware'
  | 'inputloader'
  | 'modsettings'
  | 'nativesettings'
  | 'redmod'

export type ModType =
  | 'archive' // .archive in archive/pc/mod
  | 'xl' // ArchiveXL-Datei (.xl)
  | 'cet' // Lua-Mod für Cyber Engine Tweaks
  | 'reds' // redscript
  | 'red4ext' // RED4ext-Plugin (dll)
  | 'tweak' // TweakXL (.yaml/.tweak)
  | 'redmod' // REDmod-Ordner unter mods/
  | 'input' // Input Loader (.xml in r6/input)
  | 'asi' // ASI-Plugin in bin/x64/plugins
  | 'framework' // bringt selbst ein Framework mit
  | 'other'

export interface GameInfo {
  found: boolean
  root: string // Windows-Pfad zur Spielwurzel
  store: 'steam' | 'gog' | 'epic' | 'manual'
  patch: string // ProductVersion der exe, z. B. "2.5"
  build: string // FileVersion der exe, z. B. "3.0.5813403"
  exeTime: number // mtime der exe (ms)
  phantomLiberty: boolean
  redmodTool: boolean // tools/redmod/bin/redMod.exe vorhanden
  language: string
  updatedSinceLastRun: boolean // build anders als beim letzten Start
  previousBuild: string | null
  error?: string
}

export interface ModFile {
  dst: string // Ziel relativ zur Spielwurzel
  size: number
}

export interface ModSource {
  kind: 'file' | 'nexus'
  archive: string // Dateiname in downloads/
  nexusModId?: number
  nexusFileId?: number
  nexusCategory?: string // MAIN, OPTIONAL, …
  nexusFile?: string // Titel der Nexus-Datei ("Garage Core"); unterscheidet die Dateien eines Multi-File-Mods
}

/** Woher ein Mod kam, wenn nicht einzeln geladen: aus einer Collection, einem Shard oder als Requirement. */
export interface ModOrigin {
  kind: 'collection' | 'shard' | 'requirement'
  title: string // Name der Collection / des Shards / des Mods, der es braucht
}

/** Meldung aus dem Main-Prozess an die Oberfläche. */
export interface Notice {
  tone: 'info' | 'ok' | 'warn' | 'alert'
  title: string
  body?: string
}

/** Infos von Nexus, wenn ein Mod über Nexus kam (oder seine ID bekannt ist). */
export interface NexusInfo {
  author?: string
  summary?: string
  picture?: string // Vorschaubild (Thumbnail-URL)
  url: string
}

/** Was beim Download von Nexus über die Datei bekannt ist; fließt in den Import. */
export interface NexusMeta {
  modId: number
  fileId: number
  modName: string
  fileName: string
  version: string
  category?: string // MAIN, OPTIONAL, UPDATE, …
  author?: string
  summary?: string
  picture?: string
  supersedes?: number[] // Datei-IDs, die diese Datei laut Nexus-Update-Kette ersetzt
  replaceRecord?: string // Update aus RIPPERDOC heraus: diesen Mod ersetzen
  fileTitle?: string // Titel der Datei bei Nexus ("Garage Core")
  auto?: boolean // ohne Dialog installieren, wenn nichts zu entscheiden ist
  origin?: ModOrigin
}

export interface ModRecord {
  id: string
  name: string
  version: string
  source: ModSource
  nexus?: NexusInfo
  installedAt: string // ISO
  types: ModType[]
  files: ModFile[]
  docs: string[] // Liesmich & Co., liegen nur im Staging
  provides: FrameworkId[]
  requires: FrameworkId[]
  recommends?: FrameworkId[] // optional, z. B. Mod Settings
  skipped: string[] // Dateien, die nicht installiert wurden (unbekannt oder gesperrt)
  rule: string // welche Erkennungsregel gegriffen hat
  origin?: ModOrigin
}

export interface Profile {
  name: string
  // Reihenfolge = Priorität: Index 0 gewinnt bei gleichen Zielpfaden.
  order: string[]
  enabled: Record<string, boolean>
}

export interface Conflict {
  dst: string
  winner: string // Mod-ID
  losers: string[]
}

export interface MissingDep {
  modId: string
  framework: FrameworkId
}

/** Ein Nexus-Mod, den ein anderer Mod laut seiner Nexus-Seite braucht ("Requirements"). */
export interface NexusRequirement {
  modId: number
  name: string
  notes: string
  optional: boolean // laut Notiz des Autors optional
  state: 'ok' | 'off' | 'missing' // aktiv da / installiert, aber aus / fehlt
  recordId?: string // passender installierter Mod
}

/** Fehlendes Nexus-Requirement eines aktiven Mods (aus dem Cache, ohne Netz berechnet). */
export interface MissingNexus {
  modId: string // Mod im Inventar, der es braucht
  nexusModId: number
  name: string
  off: boolean // installiert, aber ausgeschaltet
}

/** Ergebnis von "fehlende Requirements holen" / "Plan laden". */
export interface FetchRun {
  queued: DownloadItem[] // direkt geladen (Premium)
  opened: number // Nexus-Seiten im Browser geöffnet (ohne Premium)
  left: number // ohne Premium: noch nicht geöffnete Seiten (nächste Portion)
  failed: { name: string; error: string }[]
}

export interface DeployState {
  deployed: number // Dateien im Spielordner, die uns gehören
  mode: 'hardlink' | 'copy'
  lastApply: string | null
  snapshot: boolean // Vanilla-Snapshot vorhanden
  suspended: boolean // VANILLA-Modus nach PURGE
}

export interface InventoryView {
  mods: ModRecord[]
  profile: Profile
  conflicts: Conflict[]
  missing: MissingDep[]
  deploy: DeployState
  installedFrameworks: FrameworkId[] // von aktiven Mods geliefert oder fremd im Spielordner gefunden
  updates: Record<string, UpdateInfo> // je Mod-ID, aus dem letzten Update-Check
  missingNexus: MissingNexus[]
}

// ---------- Nexus ----------

export interface NexusUser {
  name: string
  premium: boolean
  supporter: boolean
}

export type NxmState = 'ours' | 'other' | 'none'

/** Nexus antwortet gerade nicht oder nur mit Störungen (Netz, 5xx, Zeitlimit). */
export interface NexusOutage {
  message: string
  since: number
  retryAt: number | null // nächster automatischer Versuch
}

/** Aus der öffentlichen Statusseite von Nexus. */
export interface NexusHealth {
  indicator: 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown'
  description: string // z. B. "Partially Degraded Service"
  incident: string | null // z. B. "Slow website / API responses"
  incidentNote: string | null
  degraded: string[] // Bereiche, die nicht normal laufen ("API", "Nexus Mods Website")
  checkedAt: number
}

export interface NexusStatus {
  hasKey: boolean
  user: NexusUser | null
  verified: boolean // Konto in dieser Sitzung von Nexus bestätigt; sonst das zuletzt bekannte
  checking: boolean
  error: string | null // Problem mit dem Key (nicht mit Nexus)
  outage: NexusOutage | null
  health: NexusHealth | null
  nxm: NxmState
  nxmOther: string | null // Name des Programms, das nxm:// sonst öffnet
  rate: { hourly: number; daily: number } | null
  canEncrypt: boolean
  lastCheck: string | null
}

export type DownloadState = 'queued' | 'preparing' | 'downloading' | 'done' | 'error' | 'canceled'

export interface DownloadItem {
  id: string
  name: string
  fileName: string
  version: string
  nexusModId?: number
  nexusFileId?: number
  total: number
  received: number
  speed: number // Bytes pro Sekunde
  state: DownloadState
  error?: string
  note?: string // z. B. "Verbindung abgebrochen, neuer Versuch in 5 s"
  resumed?: boolean // an einer abgebrochenen Stelle weitergeladen
  linkExpires?: number // Unix-Zeit, bis wann die Freigabe aus dem nxm-Link gilt
  startedAt?: number
  finishedAt?: number
  auto?: boolean // wird ohne Dialog installiert, wenn nichts zu entscheiden ist
  origin?: ModOrigin
}

export interface UpdateInfo {
  recordId: string
  nexusModId: number
  installed: string
  latest: string | null
  latestFileId: number | null
  latestFileName: string | null
  hasUpdate: boolean // mit latestFileId null: Datei ist veraltet, den Nachfolger gibt es nur auf Nexus zur Wahl
  checkedAt: string
  error?: string
}

// ---------- Collections und Shards ----------

// update = Plan-Datei ist neuer als die installierte; older = installierte ist gleich alt oder neuer (nie automatisch ersetzen)
export type PlanEntryState = 'installed' | 'update' | 'older' | 'missing' | 'unavailable'

/** Eine Datei in einer Nexus-Collection oder einem geteilten Shard. */
export interface PlanEntry {
  key: string // "<modId>:<fileId>"
  modId: number
  fileId: number // 0 = Hauptdatei des Mods (Shard aus einem Mod ohne bekannte Datei-ID)
  modName: string
  fileTitle: string
  version: string
  size: number // Bytes, 0 = unbekannt
  optional: boolean
  adult: boolean
  picture?: string
  author?: string
  enabled?: boolean // Shard: war beim Absender aktiv
  state: PlanEntryState
  recordId?: string // installierter Mod dazu (installed/update/older)
  installedVersion?: string // update/older: Version der installierten Datei
  opened?: boolean // Nexus-Seite schon geöffnet (ohne Premium)
  download?: { id: string; state: DownloadState }
}

export interface ModPlan {
  id: string
  kind: 'collection' | 'shard'
  title: string
  author: string | null
  summary: string | null
  picture: string | null
  url: string | null
  revision: number | null
  adult: boolean
  patch: string | null // Shard: Spielversion beim Absender
  created: string | null
  entries: PlanEntry[]
  local: { name: string; version: string }[] // Shard: Mods ohne Nexus-ID, nur als Name
}

/** Eigene Mod-Liste zum Teilen. */
export interface ShareExport {
  code: string // RDSHARD1:… zum Einfügen
  text: string // Liste mit Nexus-Links (Discord, Reddit)
  nexus: number
  local: number
}

export interface ShareOptions {
  title: string
  onlyActive: boolean
}

export interface DownloadsUsage {
  files: number
  bytes: number
  unused: number // Archive, die zu keinem installierten Mod mehr gehören
  unusedBytes: number
}

export interface ImportPreview {
  token: string
  archive: string
  name: string
  version: string
  rule: string
  types: ModType[]
  mapped: { src: string; dst: string }[]
  unknown: string[]
  blocked: string[] // vom Guard gesperrte Ziele
  docs: string[]
  provides: FrameworkId[]
  requires: FrameworkId[]
  recommends: FrameworkId[]
  nexusModId: number | null // von Nexus oder aus dem Dateinamen; für die Requirements
  replaces: string | null // gleiche Nexus-ID / gleicher Name schon installiert
  replaceDefault: boolean // Haken "ersetzen" vorbelegen (sicher dasselbe Paket, nicht z. B. ein optionales Addon)
  variants: string[] // mehrere Varianten-Ordner: erst eine wählen
  variant: string | null
  nexus: NexusMeta | null
}

export type UnknownChoice = 'skip' | 'root'

export interface ImportDecision {
  token: string
  unknown: UnknownChoice
  name?: string
  replace?: boolean
  replaces?: string | null // welchen Mod der Dialog zum Ersetzen gezeigt hat; anders beim Installieren → abbrechen
}

export interface ImportFailure {
  input: string
  error: string
}

export type ImportOutcome =
  | { ok: true; mod: ModRecord; applied: ApplyReport }
  | { ok: false; error: string }

export interface ApplyReport {
  linked: number
  copied: number
  removed: number
  backedUp: number
  restored: number
  drift: string[] // Dateien, die jemand anderes geändert hat (nach overwrite/ verschoben)
  blocked: string[]
  errors: string[]
}

export interface PurgeReport extends ApplyReport {
  vanilla: SnapshotDiff | null
}

export interface SnapshotDiff {
  identical: boolean
  added: string[]
  removed: string[]
  changed: string[]
}

export interface VerifyReport {
  ok: number
  missing: string[]
  replaced: string[]
  unmanaged: string[] // Dateien in Mod-Ordnern, die weder uns noch dem Spiel gehören
}

export type GamePhase = 'idle' | 'starting' | 'running' | 'exited'

export interface GameRunState {
  phase: GamePhase
  since: number
  pid?: number
}

export type LaunchMode = 'steam' | 'direct'
export type ThemeName = 'RED' | 'AMBER' | 'ACID' | 'VIOLET' | 'ICE'

export interface Settings {
  gameRoot: string | null // null = automatisch
  dataRoot: string | null // null = <Laufwerk des Spiels>:\RipperdocData
  launchMode: LaunchMode
  skipStartScreen: boolean
  theme: ThemeName
  sound: boolean
  volume: number // 0..1
  scanlines: number // 0..1
  lastBuild: string | null
  language: LangSetting // auto = Windows-Sprache
  quickInstall: boolean // Nexus-Downloads ohne Dialog installieren, wenn nichts zu entscheiden ist
}

export interface AppInfo {
  version: string
  dataRoot: string
  sameVolume: boolean
  electron: string
  systemLang: Lang // wofür "auto" gerade steht
}

export interface JournalEntry {
  t: string
  op: string
  path?: string
  from?: string
  mod?: string
  note?: string
}
