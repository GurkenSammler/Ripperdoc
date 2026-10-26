import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { SnapshotDiff } from '@shared/types'
import { keyOf, readJson, safeJoin, walkFiles, writeJson } from '../util/paths'

// Bestandsaufnahme des Spielordners vor dem ersten Deploy: der Beweis, dass "PURGE" wirklich zurück auf
// den Ausgangszustand führt. Für r6/cache (dort schreibt redscript zur Laufzeit) gibt es zusätzlich
// Hashes und eine echte Kopie, damit diese Dateien wiederhergestellt werden können.

export interface SnapFile {
  path: string
  size: number
  mtimeMs: number
  sha1?: string
}

export interface Snapshot {
  createdAt: string
  build: string
  files: Record<string, SnapFile>
}

/** Ordner, die das Spiel selbst laufend beschreibt; beim Vergleich zählen sie nicht. */
const VOLATILE = ['r6/logs/', 'r6/config/settings/', 'r6/cache/']
export const CACHE_DIR = 'r6/cache/'

export const isVolatile = (rel: string): boolean => VOLATILE.some((v) => keyOf(rel).startsWith(v))

export async function sha1(file: string): Promise<string> {
  const hash = createHash('sha1')
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject)
  })
  return hash.digest('hex')
}

export async function takeSnapshot(gameRoot: string, build: string, cacheBackupDir: string): Promise<Snapshot> {
  const files: Record<string, SnapFile> = {}
  for (const rel of await walkFiles(gameRoot)) {
    const full = safeJoin(gameRoot, rel)
    const st = await fs.stat(full)
    const entry: SnapFile = { path: rel, size: st.size, mtimeMs: Math.round(st.mtimeMs) }
    if (keyOf(rel).startsWith(CACHE_DIR)) {
      entry.sha1 = await sha1(full)
      const copy = safeJoin(cacheBackupDir, rel)
      await fs.mkdir(path.dirname(copy), { recursive: true })
      await fs.copyFile(full, copy)
    }
    files[keyOf(rel)] = entry
  }
  return { createdAt: new Date().toISOString(), build, files }
}

export const loadSnapshot = (file: string): Promise<Snapshot | null> => readJson<Snapshot | null>(file, null)
export const saveSnapshot = (file: string, snap: Snapshot): Promise<void> => writeJson(file, snap)

/** Vergleicht den Spielordner mit dem Snapshot (nur Pfade, Größe und Zeitstempel; volatile Ordner ausgenommen). */
export async function compareSnapshot(gameRoot: string, snap: Snapshot): Promise<SnapshotDiff> {
  const added: string[] = []
  const changed: string[] = []
  const seen = new Set<string>()
  for (const rel of await walkFiles(gameRoot)) {
    if (isVolatile(rel)) continue
    const k = keyOf(rel)
    seen.add(k)
    const old = snap.files[k]
    if (!old) {
      added.push(rel)
      continue
    }
    const st = await fs.stat(safeJoin(gameRoot, rel))
    if (st.size !== old.size || Math.abs(Math.round(st.mtimeMs) - old.mtimeMs) > 2000) changed.push(rel)
  }
  const removed = Object.entries(snap.files)
    .filter(([k, f]) => !seen.has(k) && !isVolatile(f.path))
    .map(([, f]) => f.path)
  return { identical: added.length + changed.length + removed.length === 0, added, removed, changed }
}
