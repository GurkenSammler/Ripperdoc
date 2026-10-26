import { promises as fs } from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'

/** Relativer Pfad mit "/" und ohne führende Trenner. */
export const toRel = (p: string): string => p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')

/** Schlüssel für Vergleiche: Windows unterscheidet Groß/klein nicht. */
export const keyOf = (rel: string): string => toRel(rel).toLowerCase()

/** Verbindet root und einen relativen Pfad und wirft, wenn das Ergebnis aus root herausführt. */
export function safeJoin(root: string, rel: string): string {
  const clean = toRel(rel)
  if (clean === '' || clean.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(t('main.paths.unsafe', rel))
  }
  const full = path.resolve(root, ...clean.split('/'))
  const base = path.resolve(root)
  const rootWithSep = base.endsWith(path.sep) ? base : base + path.sep
  if (!full.toLowerCase().startsWith(rootWithSep.toLowerCase())) throw new Error(t('main.paths.escapes', rel))
  return full
}

/** Ungültige Zeichen für Windows-Ordnernamen entfernen. */
export const safeName = (name: string): string =>
  name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/[. ]+$/, '')
    .trim() || 'mod'

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Alle Dateien unter dir, relativ mit "/". */
export async function walkFiles(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walkFiles(path.join(dir, e.name), rel)))
    else if (e.isFile()) out.push(rel)
  }
  return out
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

const writeChains = new Map<string, Promise<void>>()
let tmpCounter = 0

/** Windows: Virenscanner oder Indexer halten die Zieldatei kurz offen → rename scheitert mit EPERM/EBUSY. */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
}

/**
 * Erst in eine Temp-Datei schreiben, dann umbenennen: kein halbes JSON nach einem Absturz.
 * Schreibvorgänge auf dieselbe Datei laufen nacheinander (z. B. viele Regler-Bewegungen in SYS.CONFIG),
 * damit sich keine Temp-Dateien in die Quere kommen und der zuletzt gewünschte Stand gewinnt.
 */
export function writeJson(file: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2)
  const key = path.resolve(file).toLowerCase()
  const next = (writeChains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`
      await fs.writeFile(tmp, text, 'utf8')
      try {
        await renameRetry(tmp, file)
      } catch (err) {
        await fs.rm(tmp, { force: true })
        throw err
      }
    })
  writeChains.set(key, next)
  const done = () => {
    if (writeChains.get(key) === next) writeChains.delete(key)
  }
  next.then(done, done)
  return next
}

/** Gleiche Partition? Hardlinks gehen nur innerhalb eines Laufwerks. */
export const sameVolume = (a: string, b: string): boolean =>
  path.parse(path.resolve(a)).root.toLowerCase() === path.parse(path.resolve(b)).root.toLowerCase()
