import type {
  ApplyReport,
  AppInfo,
  DownloadItem,
  DownloadsUsage,
  FetchRun,
  GameInfo,
  GameRunState,
  ImportDecision,
  ImportFailure,
  ImportOutcome,
  ImportPreview,
  InventoryView,
  JournalEntry,
  ModPlan,
  NexusRequirement,
  NexusStatus,
  PurgeReport,
  Settings,
  ShareExport,
  ShareOptions,
  UpdateInfo,
  VerifyReport,
} from './types'

/** Alles, was die Oberfläche beim Main-Prozess aufrufen kann (über ipcRenderer.invoke). */
export interface CoreApi {
  appInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  sounds(): Promise<Record<string, Uint8Array>>
  gameInfo(): Promise<GameInfo>
  refreshGame(): Promise<GameInfo>
  /** Ordner-Dialog; null = abgebrochen. restart: App startet gleich neu (neuer Datenordner). */
  pickGameRoot(): Promise<{ game: GameInfo; restart: boolean } | null>
  autoGameRoot(): Promise<{ game: GameInfo; restart: boolean }>
  gameState(): Promise<GameRunState>
  inventory(): Promise<InventoryView>
  prepare(paths: string[]): Promise<{ previews: ImportPreview[]; failures: ImportFailure[] }>
  chooseVariant(token: string, variant: string): Promise<ImportPreview>
  cancelImport(token: string): Promise<void>
  commitImport(decision: ImportDecision): Promise<ImportOutcome>
  setEnabled(id: string, on: boolean): Promise<InventoryView>
  move(id: string, toIndex: number): Promise<InventoryView>
  removeMod(id: string): Promise<InventoryView>
  renameMod(id: string, name: string): Promise<InventoryView>
  purge(): Promise<PurgeReport>
  redeploy(): Promise<ApplyReport>
  verify(): Promise<VerifyReport>
  journal(limit: number): Promise<JournalEntry[]>
  launch(): Promise<void>
  openFolder(which: 'game' | 'data' | 'mod' | 'downloads', id?: string): Promise<void>
  pickFiles(): Promise<string[]>
  pendingImports(): Promise<ImportPreview[]>
  // Nexus
  nexusStatus(): Promise<NexusStatus>
  nexusSetKey(key: string): Promise<NexusStatus>
  nexusClearKey(): Promise<NexusStatus>
  nexusSetNxm(on: boolean): Promise<NexusStatus>
  nexusReconnect(): Promise<NexusStatus>
  nexusHealth(): Promise<NexusStatus>
  downloads(): Promise<DownloadItem[]>
  cancelDownload(id: string): Promise<void>
  retryDownload(id: string): Promise<DownloadItem>
  clearDownloads(): Promise<void>
  checkUpdates(): Promise<Record<string, UpdateInfo>>
  downloadUpdate(recordId: string): Promise<DownloadItem>
  openNexus(nexusModId: number | null): Promise<void>
  // Mehrere auf einmal
  setEnabledMany(ids: string[], on: boolean): Promise<InventoryView>
  removeMany(ids: string[]): Promise<InventoryView>
  // Requirements (Nexus-Seite eines Mods)
  requirements(nexusModId: number, refresh?: boolean): Promise<NexusRequirement[]>
  fetchRequirements(list: { modId: number; name: string }[], parent: string): Promise<FetchRun>
  // Collections und Shards
  loadCollection(input: string): Promise<ModPlan>
  readShard(text: string): Promise<ModPlan>
  readShardFile(path: string): Promise<ModPlan>
  openShardFile(): Promise<ModPlan | null>
  plan(id: string): Promise<ModPlan | null>
  closePlan(id: string): Promise<void>
  pendingPlans(): Promise<ModPlan[]>
  planDownload(id: string, keys: string[], force?: boolean): Promise<FetchRun>
  planApplyOrder(id: string): Promise<InventoryView>
  shareExport(o: ShareOptions): Promise<ShareExport>
  shareSave(o: ShareOptions): Promise<string | null>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  // Downloads-Ordner
  downloadsUsage(): Promise<DownloadsUsage>
  cleanDownloads(): Promise<DownloadsUsage>
  // Endorsements (Nexus-Mod-IDs, die das Konto empfohlen hat)
  nexusEndorsed(refresh?: boolean): Promise<number[]>
  nexusEndorse(nexusModId: number, version: string, on: boolean): Promise<number[]>
}

export const CORE_METHODS: (keyof CoreApi)[] = [
  'appInfo',
  'getSettings',
  'setSettings',
  'sounds',
  'gameInfo',
  'refreshGame',
  'pickGameRoot',
  'autoGameRoot',
  'gameState',
  'inventory',
  'prepare',
  'chooseVariant',
  'cancelImport',
  'commitImport',
  'setEnabled',
  'move',
  'removeMod',
  'renameMod',
  'purge',
  'redeploy',
  'verify',
  'journal',
  'launch',
  'openFolder',
  'pickFiles',
  'pendingImports',
  'nexusStatus',
  'nexusSetKey',
  'nexusClearKey',
  'nexusSetNxm',
  'nexusReconnect',
  'nexusHealth',
  'downloads',
  'cancelDownload',
  'retryDownload',
  'clearDownloads',
  'checkUpdates',
  'downloadUpdate',
  'openNexus',
  'setEnabledMany',
  'removeMany',
  'requirements',
  'fetchRequirements',
  'loadCollection',
  'readShard',
  'readShardFile',
  'openShardFile',
  'plan',
  'closePlan',
  'pendingPlans',
  'planDownload',
  'planApplyOrder',
  'shareExport',
  'shareSave',
  'copyText',
  'openUrl',
  'downloadsUsage',
  'cleanDownloads',
  'nexusEndorsed',
  'nexusEndorse',
]

export type CoreEvent = 'game-state' | 'busy' | 'inventory' | 'downloads' | 'imports' | 'nexus' | 'notify' | 'plan'

export interface RipperdocApi extends CoreApi {
  /** Echter Pfad einer per Drag & Drop abgelegten Datei. */
  pathForFile(file: File): string
  on(event: CoreEvent, cb: (payload: unknown) => void): () => void
}
