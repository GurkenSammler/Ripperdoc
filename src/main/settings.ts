import path from 'node:path'
import { BRAND } from '@shared/brand'
import type { Settings } from '@shared/types'
import { readJson, writeJson } from './util/paths'

export const DEFAULT_SETTINGS: Settings = {
  gameRoot: null,
  dataRoot: null,
  launchMode: 'direct',
  skipStartScreen: true,
  theme: 'RED',
  sound: true,
  volume: 0.6,
  scanlines: 0.5,
  lastBuild: null,
  language: 'auto',
}

export class SettingsStore {
  settings: Settings = { ...DEFAULT_SETTINGS }

  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(this.file, {})) }
    return this.settings
  }

  async patch(patch: Partial<Settings>): Promise<Settings> {
    this.settings = { ...this.settings, ...patch }
    await writeJson(this.file, this.settings)
    return this.settings
  }
}

/** Standard-Datenordner: gleiches Laufwerk wie das Spiel, damit Hardlinks gehen. */
export const defaultDataRoot = (gameRoot: string | null, fallback: string): string =>
  gameRoot ? path.join(path.parse(gameRoot).root, BRAND.dataDirName) : path.join(fallback, BRAND.dataDirName)
