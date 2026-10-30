import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { t } from '@shared/i18n'
import type { DownloadItem, ModPlan, ModRecord, PlanEntry, Profile } from '@shared/types'
import { fileTitleOf, sameTitle } from './mods/identity'
import type { CollectionData, ModBrief } from './nexus/graph'
import { collectionUrl, modUrl } from './nexus/nxm'
import { compareVersions, thumbnailOf } from './nexus/updates'

// Pläne: eine Liste von Nexus-Dateien, die man auf einmal holen kann. Quelle ist eine Nexus-Collection oder
// ein Shard (eine geteilte RIPPERDOC-Mod-Liste). Ein Shard ist JSON, als Code (RDSHARD1:…, deflate + base64url)
// oder als .rdshard-Datei. Er enthält nur Verweise auf Nexus (Mod-ID, Datei-ID), nie fremde Dateien.

export const SHARD_PREFIX = 'RDSHARD1:'
export const SHARD_EXT = '.rdshard'
const MAX_ENTRIES = 3000
const MAX_TEXT = 200

export interface ShardMod {
  modId: number
  fileId: number // 0 = Hauptdatei
  name: string
  version: string
  title?: string // Titel der Nexus-Datei
  on: boolean
}

export interface Shard {
  title: string
  patch: string | null
  created: string
  mods: ShardMod[] // Reihenfolge = Priorität beim Absender (oben gewinnt)
  local: { name: string; version: string }[] // Mods ohne Nexus-ID, nur als Hinweis
}

/** Gespeicherter Plan ohne den Abgleich mit dem Inventar (den rechnet resolvePlan jedes Mal frisch). */
export interface StoredPlan extends Omit<ModPlan, 'entries'> {
  entries: (Omit<PlanEntry, 'state' | 'recordId' | 'installedVersion' | 'opened' | 'download'> & { unavailable: boolean })[]
  opened: Set<string>
}

// ---------- Shards ----------

export function shardFromInventory(mods: ModRecord[], profile: Profile, title: string, onlyActive: boolean, patch: string | null): Shard {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const shard: Shard = { title: title.trim().slice(0, MAX_TEXT) || 'RIPPERDOC', patch, created: new Date().toISOString(), mods: [], local: [] }
  for (const id of profile.order) {
    const m = byId.get(id)
    const on = !!profile.enabled[id]
    if (!m || (onlyActive && !on)) continue
    if (m.source.nexusModId !== undefined) {
      const title = fileTitleOf(m)
      shard.mods.push({
        modId: m.source.nexusModId,
        fileId: m.source.nexusFileId ?? 0,
        name: m.name,
        version: m.version,
        // Gleich dem Namen: weglassen (spart Platz im Code, shardPlan nimmt dann den Namen)
        title: title && title !== m.name ? title : undefined,
        on,
      })
    } else {
      shard.local.push({ name: m.name, version: m.version })
    }
  }
  return shard
}

/** Kompakt: kurze Schlüssel, Mods als Arrays [modId, fileId, name, version, an, titel?]. */
function compact(s: Shard): unknown {
  return {
    rd: 1,
    t: s.title,
    p: s.patch,
    c: s.created,
    m: s.mods.map((m) => [m.modId, m.fileId, m.name, m.version, m.on ? 1 : 0, ...(m.title ? [m.title] : [])]),
    l: s.local.map((l) => [l.name, l.version]),
  }
}

export const encodeShard = (s: Shard): string => SHARD_PREFIX + deflateRawSync(Buffer.from(JSON.stringify(compact(s)), 'utf8')).toString('base64url')

export const shardFile = (s: Shard): string => JSON.stringify(compact(s), null, 1)

const str = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' ? v.slice(0, max) : '')
const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null)

/** Code oder Dateiinhalt → Shard. Alles Unerwartete wird abgelehnt statt halb übernommen. */
export function decodeShard(input: string): Shard {
  const text = input.trim()
  let raw: unknown
  try {
    if (text.startsWith('{')) raw = JSON.parse(text)
    else {
      const at = text.indexOf(SHARD_PREFIX)
      if (at < 0) throw new Error('prefix')
      const body = text.slice(at + SHARD_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '')
      raw = JSON.parse(inflateRawSync(Buffer.from(body, 'base64url'), { maxOutputLength: 4 * 1024 * 1024 }).toString('utf8'))
    }
  } catch {
    throw new Error(t('main.shard.unreadable'))
  }
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object' || o.rd !== 1 || !Array.isArray(o.m)) throw new Error(t('main.shard.unreadable'))
  if (o.m.length > MAX_ENTRIES) throw new Error(t('main.shard.tooBig', MAX_ENTRIES))
  const mods: ShardMod[] = []
  for (const e of o.m as unknown[]) {
    if (!Array.isArray(e)) continue
    const modId = id(e[0])
    const fileId = id(e[1])
    if (!modId || fileId === null) continue
    mods.push({ modId, fileId, name: str(e[2]) || `#${modId}`, version: str(e[3], 40) || '?', on: e[4] !== 0, title: str(e[5]) || undefined })
  }
  const local = Array.isArray(o.l)
    ? (o.l as unknown[]).filter(Array.isArray).slice(0, MAX_ENTRIES).map((l) => ({ name: str((l as unknown[])[0]) || '?', version: str((l as unknown[])[1], 40) || '?' }))
    : []
  const created = str(o.c, 40)
  return { title: str(o.t) || 'Shard', patch: str(o.p, 20) || null, created: Number.isFinite(Date.parse(created)) ? created : '', mods, local }
}

/** Liste zum Posten (Discord, Reddit): Markdown mit Nexus-Links. */
export function shardText(s: Shard): string {
  const lines = [t('main.shard.textHead', s.title, s.patch, s.mods.length + s.local.length), '']
  // Eckige Klammern im Namen würden den Markdown-Link zerlegen
  const label = (n: string) => n.replace(/[[\]]/g, '')
  s.mods.forEach((m, i) =>
    lines.push(`${i + 1}. [${label(m.name)}](${modUrl(m.modId)}) ${m.version !== '?' ? `v${m.version}` : ''}${m.on ? '' : ` ${t('main.shard.textOff')}`}`.trimEnd()),
  )
  if (s.local.length) lines.push('', `${t('main.shard.textLocal')} ${s.local.map((l) => l.name).join(', ')}`)
  return lines.join('\n')
}

// ---------- Pläne bauen ----------

export function collectionPlan(c: CollectionData, planId: string): StoredPlan {
  return {
    id: planId,
    kind: 'collection',
    title: c.name,
    author: c.author,
    summary: c.summary,
    picture: c.picture,
    url: collectionUrl(c.slug),
    revision: c.revision,
    adult: c.adult,
    patch: null,
    created: null,
    local: [],
    opened: new Set(),
    entries: c.files.map((f) => {
      const file = f.file
      const mod = file?.mod
      return {
        key: `${file?.modId ?? 0}:${f.fileId}`,
        modId: file?.modId ?? 0,
        fileId: f.fileId,
        modName: mod?.name ?? file?.name ?? `#${f.fileId}`,
        fileTitle: file?.name ?? '',
        version: file?.version ?? '?',
        size: file?.size ?? 0,
        optional: f.optional,
        adult: !!mod?.adult,
        picture: thumbnailOf(mod?.picture),
        author: mod?.author ?? undefined,
        unavailable: !file || !mod || !mod.available || file.category === 'REMOVED',
      }
    }),
  }
}

export function shardPlan(s: Shard, planId: string, briefs: Map<number, ModBrief>): StoredPlan {
  const seen = new Set<string>()
  return {
    id: planId,
    kind: 'shard',
    title: s.title,
    author: null,
    summary: null,
    picture: null,
    url: null,
    revision: null,
    adult: s.mods.some((m) => briefs.get(m.modId)?.adult),
    patch: s.patch,
    created: s.created || null,
    local: s.local,
    opened: new Set(),
    entries: s.mods.flatMap((m) => {
      const key = `${m.modId}:${m.fileId}`
      if (seen.has(key)) return []
      seen.add(key)
      const b = briefs.get(m.modId)
      return [
        {
          key,
          modId: m.modId,
          fileId: m.fileId,
          modName: m.name,
          fileTitle: m.title ?? m.name,
          version: m.version,
          size: 0,
          optional: !m.on,
          adult: !!b?.adult,
          picture: thumbnailOf(b?.picture),
          author: b?.author ?? undefined,
          enabled: m.on,
          // Ohne Antwort von Nexus nicht als fehlend markieren; der Download sagt dann Genaueres
          unavailable: !!b && !b.available,
        },
      ]
    }),
  }
}

const ACTIVE = new Set(['queued', 'preparing', 'downloading'])

/**
 * Plan gegen Inventar und Downloads: was ist schon da, was ist neuer/älter, was fehlt, was lädt gerade.
 * waiting: "<modId>:<fileId>" von Downloads, deren Import-Dialog gerade offen ist (nicht noch einmal laden).
 */
export function resolvePlan(p: StoredPlan, mods: ModRecord[], downloads: DownloadItem[], waiting: Set<string> = new Set()): ModPlan {
  const { opened, ...rest } = p
  return {
    ...rest,
    entries: p.entries.map(({ unavailable, ...e }) => {
      const same = mods.filter((m) => m.source.nexusModId === e.modId)
      const titled = same.find((m) => sameTitle(fileTitleOf(m), e.fileTitle))
      // Datei-ID 0 (Shard ohne bekannte Datei): der Titel entscheidet, sonst der einzige Mod mit dieser ID
      const exact = e.fileId > 0 ? same.find((m) => m.source.nexusFileId === e.fileId) : (titled ?? (same.length === 1 ? same[0] : undefined))
      // Andere Datei desselben Mods: gleiche Datei in anderer Version, wenn der Titel passt (oder es nur eine ohne Titel gibt)
      const other = exact ? undefined : (titled ?? (same.length === 1 && !fileTitleOf(same[0]) ? same[0] : undefined))
      const dl = downloads.find((d) => d.nexusModId === e.modId && (e.fileId === 0 || d.nexusFileId === e.fileId) && (ACTIVE.has(d.state) || d.state === 'error'))
      // Nur eine wirklich neuere Version gilt als Update; gleich alt oder unklar: nie automatisch ersetzen
      const newer = other ? compareVersions(e.version, other.version) === 1 : false
      const state: PlanEntry['state'] = exact ? 'installed' : other ? (newer ? 'update' : 'older') : unavailable ? 'unavailable' : 'missing'
      const dialog = waiting.has(e.key) || [...waiting].some((k) => e.fileId === 0 && k.startsWith(`${e.modId}:`))
      return {
        ...e,
        state,
        recordId: (exact ?? other)?.id,
        installedVersion: other?.version,
        opened: opened.has(e.key) || undefined,
        download:
          state === 'installed' ? undefined : dl ? { id: dl.id, state: dl.state } : dialog ? { id: '', state: 'done' as const } : undefined,
      }
    }),
  }
}
