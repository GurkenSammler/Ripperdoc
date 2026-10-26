import { t } from '@shared/i18n'
import { keyOf } from '../util/paths'

// Harte Sperre: Diese Ziele schreibt RIPPERDOC nie, egal was ein Mod mitbringt.
// Basisspiel-Archive, die exe, der Script-Cache (den verwaltet redscript selbst) und die Launcher-Dateien.
const PROTECTED_PREFIXES = ['archive/pc/content/', 'archive/pc/ep1/', 'r6/cache/', 'tools/redmod/', 'steam/']
const PROTECTED_FILES = new Set([
  'bin/x64/cyberpunk2077.exe',
  'redprelauncher.exe',
  'launcher-configuration.json',
])

/** Grund, warum ein Ziel gesperrt ist, sonst null. */
export function guardReason(dst: string): string | null {
  const k = keyOf(dst)
  if (k === '' || k.split('/').includes('..')) return t('main.guard.invalidPath')
  if (PROTECTED_FILES.has(k)) return t('main.guard.gameFile')
  const hit = PROTECTED_PREFIXES.find((p) => k.startsWith(p))
  if (hit) return t('main.guard.protectedFolder', hit)
  return null
}

export const isProtected = (dst: string): boolean => guardReason(dst) !== null
