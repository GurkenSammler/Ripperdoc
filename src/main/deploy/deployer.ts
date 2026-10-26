import { promises as fs } from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'
import type { ApplyReport, VerifyReport } from '@shared/types'
import { exists, keyOf, readJson, safeJoin, toRel, walkFiles, writeJson } from '../util/paths'
import { guardReason } from './guard'
import type { Journal } from './journal'
import { CACHE_DIR, sha1, type Snapshot } from './snapshot'

// Bringt den Spielordner in den gewünschten Zustand: Hardlinks aus dem Staging (Fallback: Kopie).
// Regeln:
//  - Vor jeder Änderung steht ein Eintrag im Journal.
//  - Fremde Dateien, die einem Mod im Weg sind, wandern nach backups/files und kommen beim Entfernen zurück.
//  - Dateien, die jemand anderes geändert oder neu angelegt hat, werden nie gelöscht, sondern nach overwrite/ verschoben.
//  - Ordner, die wir angelegt haben, räumen wir wieder ab, sobald sie leer sind.

export const OVERWRITE_ID = '__overwrite__'

export interface Desired {
  dst: string
  modId: string
  src: string // absoluter Pfad der Quelldatei (Staging oder overwrite/)
  owner?: string // bei overwrite-Dateien: der Mod, zu dem sie gehören
}

export interface DeployedFile {
  dst: string
  modId: string
  mode: 'hardlink' | 'copy'
  size: number
  mtimeMs: number
  ino: string
}

export interface OverwriteEntry {
  dst: string
  owner: string // Mod, in dessen Ordner die Datei entstanden ist
}

export interface Manifest {
  version: 1
  files: Record<string, DeployedFile>
  backups: Record<string, { dst: string; backup: string }>
  createdDirs: Record<string, { dir: string; modId: string }>
  overwrite: Record<string, OverwriteEntry>
  lastApply: string | null
  suspended: boolean // nach PURGE: Spielordner bleibt vanilla bis RE-DEPLOY
}

const emptyManifest = (): Manifest => ({
  version: 1,
  files: {},
  backups: {},
  createdDirs: {},
  overwrite: {},
  lastApply: null,
  suspended: false,
})

export const emptyReport = (): ApplyReport => ({
  linked: 0,
  copied: 0,
  removed: 0,
  backedUp: 0,
  restored: 0,
  drift: [],
  blocked: [],
  errors: [],
})

const LINK_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EINVAL', 'EACCES'])

/** Ordner, in denen Mods landen; dort suchen wir nach fremden Dateien. */
export const MOD_ROOTS = ['archive/pc/mod', 'bin/x64/plugins', 'red4ext', 'r6/scripts', 'r6/tweaks', 'r6/input', 'mods', 'engine/tools']

async function lstat(p: string): Promise<import('node:fs').BigIntStats | null> {
  try {
    return await fs.lstat(p, { bigint: true })
  } catch {
    return null
  }
}

async function moveFile(from: string, to: string): Promise<string> {
  let target = to
  if (await exists(target)) {
    const ext = path.extname(to)
    target = `${to.slice(0, to.length - ext.length)}.${Date.now()}${ext}`
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  try {
    await fs.rename(from, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.copyFile(from, target)
    await fs.unlink(from)
  }
  return target
}

const ancestors = (relKey: string): string[] => {
  const parts = relKey.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/**
 * Gemeinsame Mod-Ordner (und ihre Eltern): Was dort übrig bleibt, hat eher David von Hand abgelegt als ein
 * Mod zur Laufzeit erzeugt. Solche Ordner räumen wir nur ab, wenn sie leer sind, und retten nichts daraus.
 * red4ext/ ist die Ausnahme, dort schreibt RED4ext selbst Logs hinein.
 */
const SHARED_DIRS = new Set(MOD_ROOTS.filter((r) => r !== 'red4ext').flatMap((r) => [r, ...ancestors(r)]))

export class Deployer {
  manifest: Manifest = emptyManifest()

  constructor(
    private readonly gameRoot: string,
    private readonly dataRoot: string,
    private readonly journal: Journal,
  ) {}

  get manifestFile(): string {
    return path.join(this.dataRoot, 'deployment.json')
  }
  get backupDir(): string {
    return path.join(this.dataRoot, 'backups', 'files')
  }
  get overwriteDir(): string {
    return path.join(this.dataRoot, 'overwrite')
  }

  async load(): Promise<void> {
    this.manifest = { ...emptyManifest(), ...(await readJson<Partial<Manifest>>(this.manifestFile, {})) }
  }

  async save(): Promise<void> {
    await writeJson(this.manifestFile, this.manifest)
  }

  /** Update ersetzt einen Mod: gerettete Laufzeitdateien und angelegte Ordner gehören ab jetzt dem neuen. */
  reassign(oldId: string, newId: string): void {
    for (const o of Object.values(this.manifest.overwrite)) if (o.owner === oldId) o.owner = newId
    for (const d of Object.values(this.manifest.createdDirs)) if (d.modId === oldId) d.modId = newId
  }

  /** Mod entfernt: Ordner, die er angelegt hat und in denen andere Mods noch Dateien haben, erbt einer von denen. */
  async adoptDirs(removedId: string): Promise<void> {
    let changed = false
    for (const [k, d] of Object.entries(this.manifest.createdDirs)) {
      if (d.modId !== removedId) continue
      const heir = Object.entries(this.manifest.files).find(([fk, f]) => fk.startsWith(`${k}/`) && f.modId !== OVERWRITE_ID)
      if (heir) {
        d.modId = heir[1].modId
        changed = true
      }
    }
    if (changed) await this.save()
  }

  /** Gesammelte Dateien aus overwrite/, deren Besitzer-Mod gerade aktiv ist. */
  overwriteFor(activeMods: Set<string>): Desired[] {
    return Object.values(this.manifest.overwrite)
      .filter((o) => activeMods.has(o.owner))
      .map((o) => ({ dst: o.dst, modId: OVERWRITE_ID, src: safeJoin(this.overwriteDir, o.dst), owner: o.owner }))
  }

  private isOurs(cur: import('node:fs').BigIntStats, rec: DeployedFile): boolean {
    if (rec.mode === 'hardlink') return cur.ino.toString() === rec.ino
    return Number(cur.size) === rec.size && Math.abs(Number(cur.mtimeMs) - rec.mtimeMs) < 2000
  }

  /** Eigentümer eines Pfads: der tiefste von uns angelegte Ordner darüber. */
  private ownerOf(relKey: string): string | null {
    const hits = ancestors(relKey).filter((a) => this.manifest.createdDirs[a])
    const deepest = hits[hits.length - 1]
    return deepest ? this.manifest.createdDirs[deepest].modId : null
  }

  /** Datei aus dem Spielordner nach overwrite/ retten (nie löschen). */
  private async rescue(rel: string, owner: string | null, report: ApplyReport, why: string): Promise<void> {
    const from = safeJoin(this.gameRoot, rel)
    await this.journal.write({ op: 'rescue', path: rel, note: why, mod: owner ?? undefined })
    const k = keyOf(rel)
    const to = safeJoin(this.overwriteDir, rel)
    // ältere gerettete Fassung derselben Datei ist überholt
    if (await exists(to)) await fs.unlink(to)
    await moveFile(from, to)
    if (owner) this.manifest.overwrite[k] = { dst: toRel(rel), owner }
    report.drift.push(toRel(rel))
  }

  private async ensureParent(dst: string, modId: string): Promise<void> {
    const parts = toRel(dst).split('/')
    for (let i = 1; i < parts.length; i++) {
      const rel = parts.slice(0, i).join('/')
      const full = safeJoin(this.gameRoot, rel)
      if (await exists(full)) continue
      await this.journal.write({ op: 'mkdir', path: rel, mod: modId })
      await fs.mkdir(full)
      this.manifest.createdDirs[keyOf(rel)] = { dir: rel, modId }
    }
  }

  private async restoreBackup(k: string, report: ApplyReport): Promise<void> {
    const b = this.manifest.backups[k]
    if (!b) return
    if (!(await exists(b.backup))) {
      // Sicherung weg (Virenscanner, von Hand gelöscht): melden statt jeden weiteren Lauf scheitern zu lassen
      report.errors.push(t('main.deploy.backupMissing', b.dst, b.backup))
      delete this.manifest.backups[k]
      return
    }
    const target = safeJoin(this.gameRoot, b.dst)
    const cur = await lstat(target)
    if (cur) await this.rescue(b.dst, this.ownerOf(k), report, t('main.journal.onBackupSpot'))
    await this.journal.write({ op: 'restore', path: b.dst, from: b.backup })
    await fs.mkdir(path.dirname(target), { recursive: true })
    await moveFile(b.backup, target)
    delete this.manifest.backups[k]
    report.restored++
  }

  /** Spielordner auf genau `desired` bringen. */
  async apply(desired: Map<string, Desired>): Promise<ApplyReport> {
    const report = emptyReport()
    try {
      // 1. Alles entfernen, was nicht mehr (oder von einem anderen Mod) gewünscht ist
      for (const [k, rec] of Object.entries(this.manifest.files)) {
        const want = desired.get(k)
        const target = safeJoin(this.gameRoot, rec.dst)
        const cur = await lstat(target)
        if (want && want.modId === rec.modId) {
          // Bleibt, wenn der Link noch heil ist; sonst unten neu verlinken (Selbstheilung)
          if (cur && this.isOurs(cur, rec)) continue
          if (cur) await this.rescue(rec.dst, rec.modId === OVERWRITE_ID ? this.ownerOf(k) : rec.modId, report, t('main.journal.changedOutside'))
          delete this.manifest.files[k]
          continue
        }
        if (cur && this.isOurs(cur, rec)) {
          await this.journal.write({ op: 'unlink', path: rec.dst, mod: rec.modId })
          await fs.unlink(target)
          report.removed++
        } else if (cur) {
          await this.rescue(rec.dst, rec.modId === OVERWRITE_ID ? this.ownerOf(k) : rec.modId, report, t('main.journal.changedOutside'))
        }
        delete this.manifest.files[k]
        if (!want) await this.restoreBackup(k, report)
      }

      // 2. Fehlende Dateien verlinken
      let ops = 0
      for (const [k, want] of desired) {
        if (this.manifest.files[k]) continue
        const reason = guardReason(want.dst)
        if (reason) {
          report.blocked.push(`${want.dst} (${reason})`)
          continue
        }
        try {
          const target = safeJoin(this.gameRoot, want.dst)
          await this.ensureParent(want.dst, want.owner ?? want.modId)
          const cur = await lstat(target)
          if (cur?.isDirectory()) {
            report.errors.push(t('main.deploy.folderInTheWay', want.dst))
            continue
          }
          // Unser eigener Link aus einem abgebrochenen Lauf (Manifest nicht mehr gespeichert): übernehmen,
          // nicht als fremde Datei sichern (sonst käme er beim Entfernen als "Original" zurück)
          const src = cur ? await lstat(want.src) : null
          if (cur && src && cur.dev === src.dev && cur.ino === src.ino) {
            this.manifest.files[k] = {
              dst: toRel(want.dst),
              modId: want.modId,
              mode: 'hardlink',
              size: Number(cur.size),
              mtimeMs: Number(cur.mtimeMs),
              ino: cur.ino.toString(),
            }
            continue
          }
          let backedUpNow = false
          if (cur) {
            if (!this.manifest.backups[k]) {
              const backup = safeJoin(this.backupDir, want.dst)
              await this.journal.write({ op: 'backup', path: want.dst, from: backup, mod: want.modId })
              const saved = await moveFile(target, backup)
              this.manifest.backups[k] = { dst: toRel(want.dst), backup: saved }
              report.backedUp++
              backedUpNow = true
            } else {
              await this.rescue(want.dst, this.ownerOf(k), report, t('main.journal.foreignFile'))
            }
          }
          let mode: DeployedFile['mode'] = 'hardlink'
          await this.journal.write({ op: 'link', path: want.dst, from: want.src, mod: want.modId })
          try {
            try {
              await fs.link(want.src, target)
              report.linked++
            } catch (err) {
              if (!LINK_FALLBACK.has((err as NodeJS.ErrnoException).code ?? '')) throw err
              await fs.copyFile(want.src, target)
              mode = 'copy'
              report.copied++
            }
          } catch (err) {
            // Verlinken gescheitert (z. B. Staging-Datei fehlt): das eben gesicherte Original sofort zurück
            if (backedUpNow && !(await lstat(target))) await this.restoreBackup(k, report)
            throw err
          }
          const st = await fs.stat(target, { bigint: true })
          this.manifest.files[k] = {
            dst: toRel(want.dst),
            modId: want.modId,
            mode,
            size: Number(st.size),
            mtimeMs: Number(st.mtimeMs),
            ino: st.ino.toString(),
          }
        } catch (err) {
          report.errors.push(`${want.dst}: ${(err as Error).message}`)
        }
        if (++ops % 200 === 0) await this.save()
      }

      // 3. Gesicherte Originale, auf deren Platz kein Mod mehr liegt, zurücklegen (Selbstheilung)
      for (const k of Object.keys(this.manifest.backups)) {
        if (!this.manifest.files[k] && !desired.has(k)) await this.restoreBackup(k, report)
      }

      // 4. Eigene Ordner abräumen, in denen nichts von uns mehr liegt
      await this.cleanupDirs(report)
    } finally {
      this.manifest.lastApply = new Date().toISOString()
      await this.save()
    }
    return report
  }

  private async cleanupDirs(report: ApplyReport): Promise<void> {
    const used = new Set<string>()
    for (const k of Object.keys(this.manifest.files)) for (const a of ancestors(k)) used.add(a)
    const dirs = Object.keys(this.manifest.createdDirs).sort((a, b) => b.split('/').length - a.split('/').length)
    for (const k of dirs) {
      if (used.has(k)) continue
      const { dir, modId } = this.manifest.createdDirs[k]
      const full = safeJoin(this.gameRoot, dir)
      if (!(await exists(full))) {
        delete this.manifest.createdDirs[k]
        continue
      }
      if (SHARED_DIRS.has(k)) {
        // Gemeinsamer Mod-Ordner: nur leer entfernen, fremde Dateien darin nie anfassen
        if ((await fs.readdir(full)).length === 0) {
          await this.journal.write({ op: 'rmdir', path: dir })
          await fs.rmdir(full)
          delete this.manifest.createdDirs[k]
        }
        continue
      }
      // Übrig gebliebene Dateien hat ein Mod zur Laufzeit erzeugt (Logs, Einstellungen): retten
      for (const rel of await walkFiles(full)) await this.rescue(`${dir}/${rel}`, this.ownerOf(keyOf(`${dir}/${rel}`)) ?? modId, report, t('main.journal.runtime'))
      try {
        await this.journal.write({ op: 'rmdir', path: dir })
        await fs.rm(full, { recursive: true })
        delete this.manifest.createdDirs[k]
      } catch (err) {
        report.errors.push(`${dir}: ${(err as Error).message}`)
      }
    }
  }

  /** Alles von uns aus dem Spielordner nehmen und gesicherte Dateien zurücklegen. */
  async purge(): Promise<ApplyReport> {
    const report = await this.apply(new Map())
    for (const k of Object.keys(this.manifest.backups)) await this.restoreBackup(k, report)
    await this.save()
    return report
  }

  /**
   * r6/cache auf den Snapshot zurücksetzen (redscript schreibt dort hinein). Nur wenn das Spiel seit dem
   * Snapshot nicht aktualisiert wurde: nach einem Patch sind die alten Kopien veraltet und neue Cache-Dateien
   * echte Spieldateien, die auf keinen Fall weggeräumt werden dürfen. Dann bleibt r6/cache unberührt.
   */
  async restoreCache(snap: Snapshot, vanillaDir: string, build: string, report: ApplyReport, explain = false): Promise<void> {
    if (snap.build !== build) {
      if (explain) {
        report.errors.push(t('main.deploy.cacheNotChecked', snap.build, build))
      }
      return
    }
    const cacheRoot = safeJoin(this.gameRoot, CACHE_DIR)
    const current = (await walkFiles(cacheRoot)).map((r) => `${CACHE_DIR}${r}`)
    const snapCache = Object.values(snap.files).filter((f) => keyOf(f.path).startsWith(CACHE_DIR))
    const extrasDir = path.join(this.dataRoot, 'backups', 'cache-extras', new Date().toISOString().replace(/[:.]/g, '-'))
    const restoreFrom = async (rel: string, full: string): Promise<void> => {
      const copy = safeJoin(vanillaDir, rel)
      if (!(await exists(copy))) {
        report.errors.push(t('main.deploy.vanillaCopyMissing', rel))
        return
      }
      await this.journal.write({ op: 'restore-cache', path: rel })
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.copyFile(copy, full)
      report.restored++
    }

    for (const rel of current) {
      const k = keyOf(rel)
      const old = snap.files[k]
      const full = safeJoin(this.gameRoot, rel)
      if (!old) {
        await this.journal.write({ op: 'cache-extra', path: rel, from: extrasDir })
        await moveFile(full, safeJoin(extrasDir, rel))
        continue
      }
      if (!old.sha1) continue
      // Erst billig über Größe/Zeit prüfen, nur bei Abweichung hashen (die Dateien sind ~50 MB groß)
      const st = await fs.stat(full)
      if (st.size === old.size && Math.abs(Math.round(st.mtimeMs) - old.mtimeMs) < 2000) continue
      if ((await sha1(full)) === old.sha1) continue
      await restoreFrom(rel, full)
    }
    for (const f of snapCache) {
      const full = safeJoin(this.gameRoot, f.path)
      if (!(await exists(full))) await restoreFrom(f.path, full)
    }
  }

  /** Stimmt der Spielordner noch mit dem Manifest? Und liegen fremde Dateien in Mod-Ordnern? */
  async verify(snap: Snapshot | null): Promise<VerifyReport> {
    const out: VerifyReport = { ok: 0, missing: [], replaced: [], unmanaged: [] }
    for (const rec of Object.values(this.manifest.files)) {
      const cur = await lstat(safeJoin(this.gameRoot, rec.dst))
      if (!cur) out.missing.push(rec.dst)
      else if (!this.isOurs(cur, rec)) out.replaced.push(rec.dst)
      else out.ok++
    }
    for (const root of MOD_ROOTS) {
      for (const rel of await walkFiles(safeJoin(this.gameRoot, root))) {
        const full = `${root}/${rel}`
        const k = keyOf(full)
        if (this.manifest.files[k] || snap?.files[k]) continue
        out.unmanaged.push(full)
      }
    }
    return out
  }
}
