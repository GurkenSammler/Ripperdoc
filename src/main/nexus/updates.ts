// Versionsvergleich und Update-Erkennung aus der Dateiliste eines Nexus-Mods.

export interface NexusFile {
  file_id: number
  name: string
  version: string
  category_name: string | null
  file_name: string
  size_in_bytes?: number | null
  size_kb?: number
  uploaded_timestamp: number
}

export interface NexusFileUpdate {
  old_file_id: number
  new_file_id: number
}

export interface NexusFiles {
  files: NexusFile[]
  file_updates: NexusFileUpdate[]
}

/** Vergleicht Versionen wie "1.38.0", "v2.1a", "1.2-hotfix". null, wenn eine Seite unbekannt ist. */
export function compareVersions(a: string, b: string): number | null {
  const norm = (v: string) => v.trim().replace(/^v(?=\d)/i, '')
  const A = norm(a)
  const B = norm(b)
  if (!A || !B || A === '?' || B === '?') return null
  const pa = A.split(/[.\-_ +]/)
  const pb = B.split(/[.\-_ +]/)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0'
    const y = pb[i] ?? '0'
    const nx = x.match(/^(\d+)(.*)$/)
    const ny = y.match(/^(\d+)(.*)$/)
    if (nx && ny) {
      const d = Number(nx[1]) - Number(ny[1])
      if (d !== 0) return Math.sign(d)
      if (nx[2] !== ny[2]) return nx[2] < ny[2] ? -1 : 1
    } else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

const LIVE = new Set(['MAIN', 'UPDATE', 'OPTIONAL', 'MISCELLANEOUS'])

/** Datei-IDs, die laut Update-Kette zu `fileId` führen (Vorgänger). */
export function predecessors(files: NexusFiles, fileId: number): number[] {
  const prev = new Map<number, number[]>()
  for (const u of files.file_updates) prev.set(u.new_file_id, [...(prev.get(u.new_file_id) ?? []), u.old_file_id])
  const out = new Set<number>()
  const stack = [fileId]
  while (stack.length) {
    for (const p of prev.get(stack.pop()!) ?? []) {
      if (out.has(p)) continue
      out.add(p)
      stack.push(p)
    }
  }
  return [...out]
}

export interface UpdateResult {
  hasUpdate: boolean
  latest: string | null
  latestFileId: number | null
  latestFileName: string | null
}

/**
 * Gibt es eine neuere Datei? Mit bekannter Datei-ID folgt das der Update-Kette von Nexus
 * (old_file_id → new_file_id). Ohne Datei-ID oder ohne Kette zählt die Mod-Version.
 */
export function computeUpdate(installed: { version: string; fileId?: number }, modVersion: string, files: NexusFiles): UpdateResult {
  if (installed.fileId !== undefined) {
    const next = new Map(files.file_updates.map((u) => [u.old_file_id, u.new_file_id]))
    let cur = installed.fileId
    const seen = new Set<number>()
    while (next.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = next.get(cur)!
    }
    const target = files.files.find((f) => f.file_id === cur)
    if (cur !== installed.fileId && target) {
      return { hasUpdate: true, latest: target.version || modVersion, latestFileId: cur, latestFileName: target.file_name }
    }
  }

  const cmp = compareVersions(modVersion, installed.version)
  const mains = files.files
    .filter((f) => LIVE.has(f.category_name ?? '') && (f.category_name === 'MAIN' || f.category_name === 'UPDATE'))
    .sort((a, b) => b.uploaded_timestamp - a.uploaded_timestamp)
  const best = mains.find((f) => compareVersions(f.version, modVersion) === 0) ?? mains[0] ?? null
  if (cmp !== null && cmp > 0 && best && best.file_id !== installed.fileId) {
    return { hasUpdate: true, latest: modVersion, latestFileId: best.file_id, latestFileName: best.file_name }
  }
  return { hasUpdate: false, latest: modVersion || null, latestFileId: null, latestFileName: null }
}

/** Nexus-Bild → Vorschaubild (gleicher Pfad mit /thumbnails/). */
export const thumbnailOf = (url: string | null | undefined): string | undefined =>
  url ? url.replace(/\/images\/(\d+)\//, '/images/thumbnails/$1/') : undefined
