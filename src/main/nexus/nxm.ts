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
