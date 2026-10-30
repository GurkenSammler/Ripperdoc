import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { ImportDecision, ImportPreview, ModFile, ModRecord, NexusMeta } from '@shared/types'
import { guardReason } from '../deploy/guard'
import { analyze, parseArchiveName, summarize, type Analysis, type Mapping, type Peek } from '../install/analyze'
import { ARCHIVE_EXT, unpackInput } from '../install/extract'
import { modUrl } from '../nexus/nxm'
import { exists, keyOf, readJson, safeJoin, walkFiles, writeJson } from '../util/paths'
import { fileTitleOf, sameTitle } from './identity'

// Staging: jeder Mod liegt in <dataRoot>/mods/<id>/files/ genau so, wie er im Spielordner aussehen soll.
// Von dort verlinkt der Deployer. Originalarchive bleiben in downloads/.

interface Pending {
  token: string
  input: string
  archiveName: string
  tmp: string
  files: string[]
  analysis: Analysis
  variant: string | null
  meta?: NexusMeta
}

const PEEK_MAX = 512 * 1024

const slug = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'mod'

const RETIRED = 'mod.removed.json'

export class ModStore {
  readonly mods = new Map<string, ModRecord>()
  private readonly pending = new Map<string, Pending>()
  private readonly retired = new Set<string>()

  constructor(private readonly dataRoot: string) {}

  get modsDir(): string {
    return path.join(this.dataRoot, 'mods')
  }
  get downloadsDir(): string {
    return path.join(this.dataRoot, 'downloads')
  }
  get tmpDir(): string {
    return path.join(this.dataRoot, 'tmp')
  }

  async load(): Promise<void> {
    this.mods.clear()
    await fs.rm(this.tmpDir, { recursive: true, force: true })
    let ids: string[] = []
    try {
      ids = await fs.readdir(this.modsDir)
    } catch {
      return
    }
    for (const id of ids) {
      const dir = path.join(this.modsDir, id)
      const rec = await readJson<ModRecord | null>(path.join(dir, 'mod.json'), null)
      if (rec && rec.id === id) this.mods.set(id, rec)
      // Von einem Update ausgemustert und beim letzten Lauf nicht mehr gelöscht (z. B. Spiel lief): jetzt weg
      else if (await exists(path.join(dir, RETIRED))) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  list(): ModRecord[] {
    return [...this.mods.values()]
  }

  hasPending(token: string): boolean {
    return this.pending.has(token)
  }

  /** Archive, deren Import gerade offen ist (Dialog), dürfen beim Aufräumen nicht weg. */
  pendingInputs(): string[] {
    return [...this.pending.values()].map((p) => p.input)
  }

  /** "<modId>:<fileId>" der Nexus-Downloads, deren Import-Dialog gerade offen ist. */
  pendingNexus(): Set<string> {
    return new Set([...this.pending.values()].flatMap((p) => (p.meta ? [`${p.meta.modId}:${p.meta.fileId}`] : [])))
  }

  /**
   * Durch ein Update ersetzt, während der Spielordner noch nicht neu eingespielt ist: Die Dateien können dort noch
   * als Hardlink offen sein (Spiel läuft), Löschen schlüge fehl. Also erst nur aus der Liste nehmen und markieren;
   * purgeRetired() löscht nach dem nächsten Einspielen, load() spätestens beim nächsten Start.
   */
  async retire(id: string): Promise<void> {
    this.mods.delete(id)
    this.retired.add(id)
    const dir = path.join(this.modsDir, id)
    await fs.rename(path.join(dir, 'mod.json'), path.join(dir, RETIRED)).catch(() => undefined)
  }

  async purgeRetired(): Promise<void> {
    for (const id of [...this.retired]) {
      try {
        await fs.rm(path.join(this.modsDir, id), { recursive: true, force: true })
        this.retired.delete(id)
      } catch {
        // Noch in Benutzung: nächster Versuch nach dem nächsten Einspielen oder beim Start
      }
    }
  }

  stagedPath = (id: string, dst: string): string => safeJoin(path.join(this.modsDir, id, 'files'), dst)

  private peekIn(tmp: string): Peek {
    return async (rel) => {
      try {
        const full = safeJoin(tmp, rel)
        const st = await fs.stat(full)
        if (st.size > PEEK_MAX) return null
        return await fs.readFile(full, 'utf8')
      } catch {
        return null
      }
    }
  }

  /** Welcher installierte Mod würde ersetzt, und ist das sicher genug, um den Haken vorzubelegen? */
  private replacement(p: Pending): { same: ModRecord | null; sure: boolean } {
    const meta = p.meta
    if (meta) {
      if (meta.replaceRecord && this.mods.has(meta.replaceRecord)) return { same: this.mods.get(meta.replaceRecord)!, sure: true }
      const cands = this.list().filter((m) => m.source.nexusModId === meta.modId)
      const chained = cands.find((m) => m.source.nexusFileId !== undefined && (meta.supersedes ?? []).includes(m.source.nexusFileId))
      if (chained) return { same: chained, sure: true }
      const sameFile = cands.find((m) => m.source.nexusFileId === meta.fileId)
      if (sameFile) return { same: sameFile, sure: true }
      if (meta.fileTitle) {
        const titled = cands.find((m) => sameTitle(fileTitleOf(m), meta.fileTitle))
        if (titled) return { same: titled, sure: true }
        // Alle Kandidaten haben einen anderen Titel: eine andere Datei desselben Mods (Addon, Teil eines
        // Multi-File-Mods wie Garage), kein Update. Nichts zum Ersetzen anbieten.
        if (cands.length && cands.every((m) => fileTitleOf(m) !== null)) return { same: null, sure: false }
      }
      const mains = cands.filter((m) => m.source.nexusCategory === 'MAIN')
      if (meta.category === 'MAIN' && mains.length === 1) return { same: mains[0], sure: true }
      // z. B. eine optionale Datei desselben Mods: anbieten, aber nicht vorbelegen
      return { same: cands[0] ?? null, sure: false }
    }
    const parsed = parseArchiveName(p.archiveName)
    const byName = this.list().find((m) => m.name.toLowerCase() === parsed.name.toLowerCase())
    if (byName) return { same: byName, sure: true }
    if (parsed.nexusModId === undefined) return { same: null, sure: false }
    const cands = this.list().filter((m) => m.source.nexusModId === parsed.nexusModId)
    // Lokales Archiv mit Nexus-Dateinamen: Titel der Datei steckt im Namen ("Garage - Service Ammo-30297-…")
    const titled = cands.find((m) => sameTitle(fileTitleOf(m), parsed.name))
    if (titled) return { same: titled, sure: true }
    // Mehrere Dateien desselben Mods und keine passt: lieber nichts anbieten als die falsche ersetzen
    return { same: cands.length === 1 ? cands[0] : null, sure: false }
  }

  private preview(p: Pending): ImportPreview {
    const parsed = parseArchiveName(p.archiveName)
    const { same, sure } = this.replacement(p)
    return {
      token: p.token,
      archive: p.archiveName,
      name: p.meta?.modName ?? parsed.name,
      version: p.meta?.version || parsed.version,
      rule: p.analysis.rule,
      types: p.analysis.types,
      mapped: p.analysis.mapped,
      unknown: p.analysis.unknown,
      blocked: p.analysis.blocked,
      docs: p.analysis.docs,
      provides: p.analysis.provides,
      requires: p.analysis.requires,
      recommends: p.analysis.recommends,
      replaces: same?.id ?? null,
      replaceDefault: !!same && sure,
      variants: p.analysis.variants,
      variant: p.variant,
      nexus: p.meta ?? null,
      nexusModId: p.meta?.modId ?? parsed.nexusModId ?? null,
    }
  }

  /** Entpackt und analysiert; noch nichts wird installiert. `meta` kommt von einem Nexus-Download. */
  async prepare(input: string, meta?: NexusMeta): Promise<ImportPreview> {
    const token = randomBytes(6).toString('hex')
    const tmp = path.join(this.tmpDir, token)
    await unpackInput(input, tmp)
    const files = await walkFiles(tmp)
    const archiveName = path.basename(input)
    // Mit Nexus-Daten den echten Mod-Namen für Ordnernamen (z. B. CET-Mod ohne Ordner) nehmen
    const analysis = await analyze(files, { archiveName: meta ? `${meta.modName}.zip` : archiveName, peek: this.peekIn(tmp) })
    const p: Pending = { token, input, archiveName, tmp, files, analysis, variant: null, meta }
    this.pending.set(token, p)
    return this.preview(p)
  }

  async chooseVariant(token: string, variant: string): Promise<ImportPreview> {
    const p = this.need(token)
    const archiveName = p.meta ? `${p.meta.modName}.zip` : p.archiveName
    p.analysis = await analyze(p.files, { archiveName, peek: this.peekIn(p.tmp), variant })
    p.variant = variant
    return this.preview(p)
  }

  async cancel(token: string): Promise<void> {
    const p = this.pending.get(token)
    this.pending.delete(token)
    if (p) await fs.rm(p.tmp, { recursive: true, force: true })
  }

  private need(token: string): Pending {
    const p = this.pending.get(token)
    if (!p) throw new Error(t('main.import.expired'))
    return p
  }

  private newId(name: string): string {
    for (;;) {
      const id = `${slug(name)}-${randomBytes(2).toString('hex')}`
      if (!this.mods.has(id)) return id
    }
  }

  /** Legt den Mod ins Staging. Gibt den neuen Datensatz und (bei Update) den ersetzten zurück. */
  async commit(decision: ImportDecision): Promise<{ mod: ModRecord; replaced: ModRecord | null }> {
    const p = this.need(decision.token)
    if (p.analysis.variants.length) throw new Error(t('main.import.chooseVariant'))
    const preview = this.preview(p)
    // Inzwischen kam ein anderer Mod dazu oder ging (z. B. Auto-Installs im Hintergrund): nicht den falschen ersetzen
    if (decision.replace && decision.replaces !== undefined && decision.replaces !== preview.replaces) throw new Error(t('main.import.replaceChanged'))
    const name = decision.name?.trim() || preview.name

    const mapped: Mapping[] = [...p.analysis.mapped]
    const skipped = [...p.analysis.blocked]
    // Unbekanntes "in die Spielwurzel": relativ zum erkannten Wurzel-Ordner (bzw. zur Variante)
    const base = p.analysis.anchor || p.variant || ''
    for (const u of p.analysis.unknown) {
      const dst = base && u.toLowerCase().startsWith(base.toLowerCase() + '/') ? u.slice(base.length + 1) : u
      if (decision.unknown === 'root' && !guardReason(dst)) mapped.push({ src: u, dst })
      else skipped.push(u)
    }
    if (mapped.length === 0) throw new Error(t('main.import.nothingToInstall'))
    // Inhalt (Abhängigkeiten) lesen, solange die Dateien noch im Temp-Ordner liegen
    const summary = decision.unknown === 'root' ? await summarize(mapped, this.peekIn(p.tmp)) : p.analysis

    const id = this.newId(name)
    const filesDir = path.join(this.modsDir, id, 'files')
    const seen = new Set<string>()
    const files: ModFile[] = []
    try {
      for (const m of mapped) {
        const k = keyOf(m.dst)
        if (seen.has(k)) {
          skipped.push(m.src)
          continue
        }
        seen.add(k)
        const to = safeJoin(filesDir, m.dst)
        await fs.mkdir(path.dirname(to), { recursive: true })
        await fs.rename(safeJoin(p.tmp, m.src), to)
        files.push({ dst: m.dst, size: (await fs.stat(to)).size })
      }
      for (const d of p.analysis.docs) {
        const to = safeJoin(path.join(this.modsDir, id, 'docs'), d)
        await fs.mkdir(path.dirname(to), { recursive: true })
        await fs.rename(safeJoin(p.tmp, d), to).catch(() => undefined)
      }
    } catch (err) {
      await fs.rm(path.join(this.modsDir, id), { recursive: true, force: true })
      throw err
    }

    const archive = await this.keepDownload(p.input)
    const parsed = parseArchiveName(p.archiveName)
    const meta = p.meta
    const nexusId = meta?.modId ?? parsed.nexusModId
    const rec: ModRecord = {
      id,
      name,
      version: preview.version,
      source: meta
        ? { kind: 'nexus', archive, nexusModId: meta.modId, nexusFileId: meta.fileId, nexusCategory: meta.category, nexusFile: meta.fileTitle }
        : { kind: 'file', archive, nexusModId: parsed.nexusModId, nexusFile: parsed.nexusModId !== undefined ? parsed.name : undefined },
      nexus:
        nexusId !== undefined ? { author: meta?.author, summary: meta?.summary, picture: meta?.picture, url: modUrl(nexusId) } : undefined,
      installedAt: new Date().toISOString(),
      types: summary.types,
      files,
      docs: p.analysis.docs,
      provides: summary.provides,
      requires: summary.requires,
      recommends: summary.recommends,
      skipped,
      rule: p.variant === null ? p.analysis.rule : t('main.import.ruleVariant', p.analysis.rule, p.variant || t('main.import.mainFolder')),
      origin: meta?.origin,
    }
    await writeJson(path.join(this.modsDir, id, 'mod.json'), rec)
    this.mods.set(id, rec)
    await this.cancel(p.token)

    const replaced = decision.replace && preview.replaces ? (this.mods.get(preview.replaces) ?? null) : null
    return { mod: rec, replaced }
  }

  /** Originalarchiv in downloads/ ablegen (nur echte Archive; lose Dateien/Ordner nicht). */
  private async keepDownload(input: string): Promise<string> {
    const base = path.basename(input)
    if (!ARCHIVE_EXT.test(input)) return base
    if (path.resolve(path.dirname(input)).toLowerCase() === path.resolve(this.downloadsDir).toLowerCase()) return base
    await fs.mkdir(this.downloadsDir, { recursive: true })
    let target = path.join(this.downloadsDir, base)
    if (await exists(target)) {
      const [a, b] = await Promise.all([fs.stat(target), fs.stat(input)])
      if (a.size === b.size) return base
      target = path.join(this.downloadsDir, `${Date.now()}-${base}`)
    }
    await fs.copyFile(input, target)
    return path.basename(target)
  }

  async rename(id: string, name: string): Promise<ModRecord> {
    const rec = this.mods.get(id)
    if (!rec) throw new Error(t('main.mods.unknown', id))
    rec.name = name.trim() || rec.name
    await writeJson(path.join(this.modsDir, id, 'mod.json'), rec)
    return rec
  }

  /** Staging-Ordner löschen. Vorher muss der Mod aus dem Spielordner genommen sein. */
  async remove(id: string): Promise<void> {
    this.mods.delete(id)
    await fs.rm(path.join(this.modsDir, id), { recursive: true, force: true })
  }
}
