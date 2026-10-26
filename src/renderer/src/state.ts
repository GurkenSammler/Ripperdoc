import { createContext, useContext } from 'react'
import type { AppInfo, DownloadItem, GameInfo, GameRunState, InventoryView, NexusStatus, Settings } from '@shared/types'
import { getLang } from '@shared/i18n'

export type ScreenId = 'inventory' | 'cyberware' | 'loadorder' | 'net' | 'journal' | 'config'

export const SCREENS: { id: ScreenId; label: string }[] = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'cyberware', label: 'Cyberware' },
  { id: 'loadorder', label: 'Load Order' },
  { id: 'net', label: 'Net' },
  { id: 'journal', label: 'Journal' },
  { id: 'config', label: 'Sys.Config' },
]

export interface Toast {
  id: number
  tone: 'info' | 'ok' | 'warn' | 'alert'
  title: string
  body?: string
}

export interface Ctx {
  app: AppInfo
  game: GameInfo
  settings: Settings
  inv: InventoryView
  nexus: NexusStatus
  setNexus: (s: NexusStatus) => void
  downloads: DownloadItem[]
  run: GameRunState
  busy: string | null
  refresh: () => Promise<void>
  /** Nach einem Wechsel des Spielordners: Spiel, Pfade, Einstellungen und Inventar neu laden. */
  reloadGame: () => Promise<void>
  setInv: (inv: InventoryView) => void
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (t: Omit<Toast, 'id'>) => void
  act: <T>(fn: () => Promise<T>) => Promise<T | undefined>
  startImport: (paths: string[]) => Promise<void>
  go: (s: ScreenId) => void
  replayBoot: () => void
}

export const CoreCtx = createContext<Ctx | null>(null)

export function useCore(): Ctx {
  const c = useContext(CoreCtx)
  if (!c) throw new Error('CoreCtx fehlt')
  return c
}

/** "Error invoking remote method 'rd:x': Error: Text" → "Text" */
export const cleanError = (err: unknown): string =>
  String((err as Error)?.message ?? err)
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')

export const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Datum + Uhrzeit, 24 h: "26.10. 14:03:22" auf Deutsch, "Oct 26 14:03:22" auf Englisch (gleich breit, eindeutig). */
export const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return getLang() === 'en' ? `${MONTHS_EN[d.getMonth()]} ${p(d.getDate())} ${time}` : `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${time}`
}

/** Datentyp beim Ziehen eines Mods in der Liste (unterscheidet das vom Datei-Drop). */
export const MOD_DRAG = 'application/x-rdoc-mod'
