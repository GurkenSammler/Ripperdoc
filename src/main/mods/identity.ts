import type { ModRecord } from '@shared/types'
import { parseArchiveName } from '../install/analyze'

// Welche Nexus-Datei steckt in einem installierten Mod? Multi-File-Mods (z. B. Garage: Core + mehrere
// Service-Teile unter einer Mod-ID) lassen sich nur über den Titel der Datei auseinanderhalten.

/**
 * "Garage - Service_Ammo" und "garage service ammo" sind derselbe Titel. Versionsnummern zählen nicht mit:
 * manche Autoren schreiben sie in den Dateititel ("CET 1.38.0 - Game version 2.5"), dann wäre jede neue
 * Version sonst eine andere Datei. Nur Nummern mit Punkt oder v-Präfix, damit "Part 1"/"Part 2" verschieden bleiben.
 */
export function normTitle(s: string): string {
  const full = s.toLowerCase()
  const bare = full.replace(/\bv?\d+(?:\.\d+)+[a-z]?\b/g, ' ').replace(/\bv\d+\b/g, ' ').replace(/[^a-z0-9]+/g, '')
  return bare || full.replace(/[^a-z0-9]+/g, '')
}

/** Titel der Nexus-Datei: gespeichert, sonst aus dem Nexus-Dateinamen des Archivs; null = unbekannt. */
export function fileTitleOf(rec: ModRecord): string | null {
  if (rec.source.nexusFile) return rec.source.nexusFile
  if (!rec.source.archive) return null
  const parsed = parseArchiveName(rec.source.archive)
  return parsed.nexusModId !== undefined ? parsed.name : null
}

export const sameTitle = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && normTitle(a) !== '' && normTitle(a) === normTitle(b)
