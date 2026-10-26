import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { GAME_EXE_REL, STEAM_APP_ID, STEAM_PL_DLC_ID } from '@shared/brand'
import { t } from '@shared/i18n'
import type { GameInfo } from '@shared/types'
import { exists } from '../util/paths'
import { readPeVersion } from './peversion'
import { child, parseVdf, value } from './vdf'

const run = promisify(execFile)

/** Liest einen Registry-Wert über reg.exe (gibt es auf jedem Windows, keine nativen Module nötig). */
export async function readRegistry(key: string, name: string): Promise<string | null> {
  try {
    const { stdout } = await run('reg.exe', ['query', key, '/v', name], { windowsHide: true })
    const line = stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().startsWith(name.toLowerCase()))
    const m = line?.match(/REG_\w+\s+(.*)$/)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

/** Alle Werte `name` unter `key` samt Unterschlüsseln (reg query /s). Fehlt der Schlüssel: leer. */
export async function readRegistryAll(key: string, name: string): Promise<string[]> {
  try {
    const { stdout } = await run('reg.exe', ['query', key, '/s', '/v', name], { windowsHide: true })
    const prefix = name.toLowerCase()
    return stdout
      .split(/\r?\n/)
      .filter((l) => l.trim().toLowerCase().startsWith(prefix))
      .map((l) => l.match(/REG_\w+\s+(.*)$/)?.[1]?.trim())
      .filter((v): v is string => !!v)
  } catch {
    return []
  }
}

export async function steamRoot(): Promise<string | null> {
  const hklm = await readRegistry('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (hklm && (await exists(hklm))) return path.normalize(hklm)
  const hkcu = await readRegistry('HKCU\\SOFTWARE\\Valve\\Steam', 'SteamPath')
  if (hkcu && (await exists(hkcu))) return path.normalize(hkcu)
  return null
}

export interface SteamHit {
  library: string
  root: string
  phantomLiberty: boolean
  language: string
}

/** Sucht Cyberpunk in allen Steam-Bibliotheken. */
export async function findInSteam(steam: string): Promise<SteamHit | null> {
  const vdfPath = path.join(steam, 'steamapps', 'libraryfolders.vdf')
  let libraries: string[] = [steam]
  try {
    const root = child(parseVdf(await fs.readFile(vdfPath, 'utf8')), 'libraryfolders')
    if (root) {
      // Bibliotheken, die die App laut vdf enthalten, zuerst
      const all = Object.values(root).filter((v): v is Exclude<typeof v, string> => typeof v === 'object')
      const withApp = all.filter((lib) => child(lib, 'apps') && value(child(lib, 'apps'), STEAM_APP_ID) !== undefined)
      const ordered = [...withApp, ...all.filter((l) => !withApp.includes(l))]
      libraries = ordered.map((lib) => value(lib, 'path')).filter((p): p is string => !!p).map((p) => path.normalize(p))
    }
  } catch {
    // ohne vdf nur die Hauptbibliothek
  }

  for (const lib of libraries) {
    const acf = path.join(lib, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`)
    let manifest
    try {
      manifest = child(parseVdf(await fs.readFile(acf, 'utf8')), 'AppState')
    } catch {
      continue
    }
    const installdir = value(manifest, 'installdir') ?? 'Cyberpunk 2077'
    const root = path.join(lib, 'steamapps', 'common', installdir)
    if (!(await exists(path.join(root, ...GAME_EXE_REL.split('/'))))) continue
    const depots = child(manifest, 'InstalledDepots')
    const phantomLiberty = !!depots && Object.values(depots).some((d) => typeof d === 'object' && value(d, 'dlcappid') === STEAM_PL_DLC_ID)
    const language = value(child(manifest, 'UserConfig'), 'language') ?? ''
    return { library: lib, root, phantomLiberty, language }
  }
  return null
}

const hasExe = (root: string): Promise<boolean> => exists(path.join(root, ...GAME_EXE_REL.split('/')))

const firstWithExe = async (roots: string[]): Promise<string | null> => {
  for (const r of roots) if (r && (await hasExe(r))) return path.normalize(r)
  return null
}

/** GOG Galaxy trägt jedes Spiel mit "path" in die Registry ein. */
export async function gogPaths(): Promise<string[]> {
  const keys = ['HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', 'HKLM\\SOFTWARE\\GOG.com\\Games']
  return (await Promise.all(keys.map((k) => readRegistryAll(k, 'path')))).flat()
}

/** Epic legt pro Spiel eine .item-Datei (JSON) in Manifests ab. */
export async function epicManifestDirs(): Promise<string[]> {
  const fromReg = await readRegistry('HKLM\\SOFTWARE\\WOW6432Node\\Epic Games\\EpicGamesLauncher', 'AppDataPath')
  const programData = process.env.ProgramData ?? 'C:\\ProgramData'
  const dirs = [fromReg, path.join(programData, 'Epic', 'EpicGamesLauncher', 'Data')].filter((d): d is string => !!d)
  return [...new Set(dirs.map((d) => path.join(path.normalize(d), 'Manifests')))]
}

export async function findInEpic(manifestDirs: string[]): Promise<string | null> {
  const roots: string[] = []
  for (const dir of manifestDirs) {
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const n of names.filter((n) => n.toLowerCase().endsWith('.item'))) {
      try {
        const item = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) as { InstallLocation?: unknown }
        if (typeof item.InstallLocation === 'string') roots.push(item.InstallLocation)
      } catch {
        // kaputte oder halb geschriebene Datei: nächste
      }
    }
  }
  return firstWithExe(roots)
}

/** Wo RIPPERDOC sucht. Tests setzen eigene Quellen ein, damit der echte PC keine Rolle spielt. */
export interface LocateSources {
  steamRoot: () => Promise<string | null>
  gogPaths: () => Promise<string[]>
  epicManifestDirs: () => Promise<string[]>
}

export const SYSTEM_SOURCES: LocateSources = { steamRoot, gogPaths, epicManifestDirs }

/** Gewählter Ordner → Spielordner. Verzeiht bin\x64 oder die exe selbst. */
export async function normalizeGameRoot(picked: string): Promise<string> {
  let p = path.normalize(picked)
  if (path.basename(p).toLowerCase() === path.basename(GAME_EXE_REL).toLowerCase()) p = path.dirname(p)
  if (!(await hasExe(p)) && (await exists(path.join(p, path.basename(GAME_EXE_REL))))) p = path.resolve(p, '..', '..')
  return p
}

/** Ermittelt alle Infos zum Spiel. manualRoot hat Vorrang (SYS.CONFIG), sonst Steam → GOG → Epic. */
export async function locateGame(manualRoot: string | null, lastBuild: string | null, sources: LocateSources = SYSTEM_SOURCES): Promise<GameInfo> {
  const empty: GameInfo = {
    found: false,
    root: '',
    store: 'manual',
    patch: '',
    build: '',
    exeTime: 0,
    phantomLiberty: false,
    redmodTool: false,
    language: '',
    updatedSinceLastRun: false,
    previousBuild: lastBuild,
  }

  let root: string | null = null
  let store: GameInfo['store'] = 'manual'
  let phantomLiberty = false
  let language = ''

  if (manualRoot) {
    if (await exists(path.join(manualRoot, ...GAME_EXE_REL.split('/')))) root = manualRoot
    else return { ...empty, error: t('main.game.noExe', manualRoot) }
    phantomLiberty = await exists(path.join(manualRoot, 'archive', 'pc', 'ep1'))
  } else {
    const steam = await sources.steamRoot()
    const hit = steam ? await findInSteam(steam) : null
    if (hit) {
      root = hit.root
      store = 'steam'
      phantomLiberty = hit.phantomLiberty
      language = hit.language
    } else {
      const gog = await firstWithExe(await sources.gogPaths())
      const epic = gog ? null : await findInEpic(await sources.epicManifestDirs())
      root = gog ?? epic
      if (!root) return { ...empty, error: t('main.game.notFoundAnywhere') }
      store = gog ? 'gog' : 'epic'
      phantomLiberty = await exists(path.join(root, 'archive', 'pc', 'ep1'))
    }
  }

  const exe = path.join(root, ...GAME_EXE_REL.split('/'))
  const stat = await fs.stat(exe)
  let patch = ''
  let build = ''
  try {
    const v = await readPeVersion(exe)
    patch = v.product
    build = v.file
  } catch (err) {
    build = `size-${stat.size}`
    patch = '?'
    console.warn('PE version read failed', err)
  }

  return {
    found: true,
    root,
    store,
    patch,
    build,
    exeTime: stat.mtimeMs,
    phantomLiberty,
    redmodTool: await exists(path.join(root, 'tools', 'redmod', 'bin', 'redMod.exe')),
    language,
    updatedSinceLastRun: lastBuild !== null && lastBuild !== build,
    previousBuild: lastBuild,
  }
}
