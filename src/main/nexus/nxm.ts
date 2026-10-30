// nxm://cyberpunk2077/mods/107/files/167620?key=…&expires=…&user_id=…
// So ruft nexusmods.com einen Mod Manager auf ("Mod Manager Download"). key/expires gelten nur kurz und
// erlauben den Download auch ohne Premium.

export const NEXUS_GAME = 'cyberpunk2077'

export interface NxmLink {
  game: string
  modId: number
  fileId: number
  key?: string
  expires?: number
  userId?: number
}

export function parseNxm(raw: string): NxmLink | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'nxm:') return null
  const m = u.pathname.match(/^\/mods\/(\d+)\/files\/(\d+)\/?$/i)
  if (!m) return null
  const num = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : undefined)
  return {
    game: u.hostname.toLowerCase(),
    modId: Number(m[1]),
    fileId: Number(m[2]),
    key: u.searchParams.get('key') ?? undefined,
    expires: num(u.searchParams.get('expires')),
    userId: num(u.searchParams.get('user_id')),
  }
}

/** Für Logs und Meldungen: Link ohne die geheimen Teile. */
export const redactNxm = (raw: string): string => raw.replace(/([?&](key|expires|user_id)=)[^&]*/gi, '$1…')

export const modUrl = (modId: number): string => `https://www.nexusmods.com/${NEXUS_GAME}/mods/${modId}`

/** Seite mit dem Knopf „Mod Manager Download“ für genau diese Datei (ohne Premium: dort „Slow download“). */
export const fileUrl = (modId: number, fileId: number): string =>
  fileId > 0 ? `${modUrl(modId)}?tab=files&file_id=${fileId}&nmm=1` : `${modUrl(modId)}?tab=files`

export const collectionUrl = (slug: string): string => `https://www.nexusmods.com/games/${NEXUS_GAME}/collections/${slug}`

export interface CollectionRef {
  game: string
  slug: string
  revision: number | null
}

/**
 * Collection aus allem, was man einfügen oder anklicken kann:
 * nxm://cyberpunk2077/collections/iszwwe/revisions/483 (Knopf auf der Website),
 * https://www.nexusmods.com/games/cyberpunk2077/collections/iszwwe(/revisions/483),
 * https://next.nexusmods.com/cyberpunk2077/collections/iszwwe, oder nur der Kurzname "iszwwe".
 */
export function parseCollectionRef(raw: string): CollectionRef | null {
  const text = raw.trim()
  if (/^[a-z0-9]{4,12}$/i.test(text)) return { game: NEXUS_GAME, slug: text.toLowerCase(), revision: null }
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean)
  let game: string | undefined
  let rest: string[]
  if (u.protocol === 'nxm:') {
    game = u.hostname
    rest = parts
  } else if (/^https?:$/.test(u.protocol) && /(^|\.)nexusmods\.com$/i.test(u.hostname)) {
    const at = parts.indexOf('collections')
    if (at < 1) return null
    game = parts[at - 1]
    rest = parts.slice(at)
  } else return null
  if (rest[0] !== 'collections' || !rest[1] || !/^[a-z0-9]+$/i.test(rest[1])) return null
  const rev = rest[2] === 'revisions' && /^\d+$/.test(rest[3] ?? '') ? Number(rest[3]) : null
  return { game: (game ?? '').toLowerCase(), slug: rest[1].toLowerCase(), revision: rev }
}
