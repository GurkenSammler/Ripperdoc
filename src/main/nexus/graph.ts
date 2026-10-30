import { t } from '@shared/i18n'
import { NexusError, type NexusClient } from './client'

// Abfragen an die GraphQL-API von Nexus (v2). Öffentliche Daten, gehen auch ohne Key:
// Requirements eines Mods ("Nexus requirements" auf der Mod-Seite), Mod-Infos für Shards, Collections.

export const GAME_ID = 3333 // Cyberpunk 2077 bei Nexus
const BATCH = 50

export interface RawRequirement {
  modId: number
  name: string
  notes: string
}

export interface ModBrief {
  modId: number
  name: string
  author: string | null
  picture: string | null
  adult: boolean
  available: boolean // veröffentlicht (nicht versteckt, gelöscht, …)
}

export interface CollectionFile {
  fileId: number
  optional: boolean
  file: {
    fileId: number
    name: string
    version: string
    modId: number
    size: number
    category: string
    mod: { modId: number; name: string; author: string | null; picture: string | null; adult: boolean; available: boolean } | null
  } | null
}

export interface CollectionData {
  slug: string
  name: string
  author: string | null
  summary: string | null
  picture: string | null
  revision: number
  adult: boolean
  files: CollectionFile[]
}

const idList = (ids: number[]): string => ids.map((id) => `{gameId: ${GAME_ID}, modId: ${Math.trunc(id)}}`).join(', ')

const chunks = <T,>(list: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const uniqueIds = (ids: number[]): number[] => [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]

interface LegacyNodes<T> {
  legacyMods: { nodes: T[] }
}

/** Requirements je Mod-ID (nur Mods auf Nexus; externe Links und andere Spiele fallen weg). */
export async function fetchRequirements(client: NexusClient, ids: number[], quick = false): Promise<Map<number, RawRequirement[]>> {
  const out = new Map<number, RawRequirement[]>()
  for (const part of chunks(uniqueIds(ids), BATCH)) {
    type Node = {
      modId: number
      modRequirements: { nexusRequirements: { nodes: { modId: string | number; modName: string; notes: string | null; externalRequirement: boolean; gameId?: string | number }[] } } | null
    }
    const data = await client.graphql<LegacyNodes<Node>>(
      `{ legacyMods(ids: [${idList(part)}], count: ${part.length}) { nodes { modId modRequirements { nexusRequirements { nodes { modId modName notes externalRequirement gameId } } } } } }`,
      undefined,
      quick,
    )
    for (const id of part) out.set(id, [])
    for (const n of data.legacyMods.nodes) {
      const reqs = n.modRequirements?.nexusRequirements.nodes ?? []
      out.set(
        n.modId,
        reqs
          .filter((r) => !r.externalRequirement && (r.gameId === undefined || Number(r.gameId) === GAME_ID) && Number(r.modId) > 0)
          .map((r) => ({ modId: Number(r.modId), name: r.modName, notes: (r.notes ?? '').trim() })),
      )
    }
  }
  return out
}

/** Name, Autor, Bild und Status mehrerer Mods (für Shards, die nur IDs mitbringen). */
export async function fetchModBriefs(client: NexusClient, ids: number[], quick = false): Promise<Map<number, ModBrief>> {
  const out = new Map<number, ModBrief>()
  for (const part of chunks(uniqueIds(ids), BATCH)) {
    type Node = { modId: number; name: string; author: string | null; pictureUrl: string | null; adultContent: boolean; status: string }
    const data = await client.graphql<LegacyNodes<Node>>(
      `{ legacyMods(ids: [${idList(part)}], count: ${part.length}) { nodes { modId name author pictureUrl adultContent status } } }`,
      undefined,
      quick,
    )
    for (const n of data.legacyMods.nodes) {
      out.set(n.modId, {
        modId: n.modId,
        name: n.name,
        author: n.author,
        picture: n.pictureUrl,
        adult: !!n.adultContent,
        available: n.status === 'published',
      })
    }
  }
  return out
}

const COLLECTION_QUERY = `query($slug: String, $rev: Int) {
  collectionRevision(slug: $slug, revision: $rev, domainName: "cyberpunk2077", viewAdultContent: true) {
    revisionNumber adultContent
    collection { name slug summary user { name } tileImage { thumbnailUrl(size: med) } }
    modFiles { fileId optional file { fileId name version modId sizeInBytes category mod { modId name author pictureUrl adultContent status } } }
  }
}`

/** Eine Revision einer Collection; ohne revision die neueste veröffentlichte. */
export async function fetchCollection(client: NexusClient, slug: string, revision: number | null): Promise<CollectionData> {
  type File = {
    fileId: number
    name: string
    version: string
    modId: number
    sizeInBytes: string | number | null
    category: string
    mod: { modId: number; name: string; author: string | null; pictureUrl: string | null; adultContent: boolean; status: string } | null
  }
  type Rev = {
    revisionNumber: number
    adultContent: boolean
    // Vorschaubild: die volle "url" liefert das CDN teils nicht aus (404), die Thumbnails schon
    collection: { name: string; slug: string; summary: string | null; user: { name: string } | null; tileImage: { thumbnailUrl: string } | null }
    modFiles: { fileId: number; optional: boolean; file: File | null }[]
  }
  const data = await client.graphql<{ collectionRevision: Rev | null }>(COLLECTION_QUERY, { slug, rev: revision ?? undefined })
  const r = data.collectionRevision
  if (!r) throw new NexusError(t('main.nexus.notFound'), 404)
  return {
    slug: r.collection.slug,
    name: r.collection.name,
    author: r.collection.user?.name ?? null,
    summary: r.collection.summary,
    picture: r.collection.tileImage?.thumbnailUrl ?? null,
    revision: r.revisionNumber,
    adult: !!r.adultContent,
    files: r.modFiles.map((m) => ({
      fileId: m.fileId,
      optional: !!m.optional,
      file: m.file
        ? {
            fileId: m.file.fileId,
            name: m.file.name,
            version: m.file.version,
            modId: m.file.modId,
            size: Number(m.file.sizeInBytes ?? 0) || 0,
            category: m.file.category,
            mod: m.file.mod
              ? {
                  modId: m.file.mod.modId,
                  name: m.file.mod.name,
                  author: m.file.mod.author,
                  picture: m.file.mod.pictureUrl,
                  adult: !!m.file.mod.adultContent,
                  available: m.file.mod.status === 'published',
                }
              : null,
          }
        : null,
    })),
  }
}
