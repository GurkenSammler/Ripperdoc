import type { FrameworkId } from './types'

export interface FrameworkDef {
  id: FrameworkId
  name: string
  short: string // Chip-Text in der Oberfläche
  // Eine dieser Dateien (relativ zur Spielwurzel, klein geschrieben) zeigt: das Framework ist da.
  markers: string[]
  github?: string // owner/repo der offiziellen Releases (Schritt 2)
  needs: FrameworkId[] // worauf das Framework selbst aufbaut
}

export const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'cet',
    name: 'Cyber Engine Tweaks',
    short: 'CET',
    markers: ['bin/x64/plugins/cyber_engine_tweaks.asi'],
    github: 'maximegmd/CyberEngineTweaks',
    needs: [],
  },
  {
    id: 'red4ext',
    name: 'RED4ext',
    short: 'RED4EXT',
    markers: ['red4ext/red4ext.dll'],
    github: 'wopss/RED4ext',
    needs: [],
  },
  {
    id: 'redscript',
    name: 'redscript',
    short: 'REDSCRIPT',
    markers: ['engine/tools/scc.exe', 'engine/tools/scc_lib.dll'],
    github: 'jac3km4/redscript',
    needs: [],
  },
  {
    id: 'archivexl',
    name: 'ArchiveXL',
    short: 'ARCHIVEXL',
    markers: ['red4ext/plugins/archivexl/archivexl.dll'],
    github: 'psiberx/cp2077-archive-xl',
    needs: ['red4ext'],
  },
  {
    id: 'tweakxl',
    name: 'TweakXL',
    short: 'TWEAKXL',
    markers: ['red4ext/plugins/tweakxl/tweakxl.dll'],
    github: 'psiberx/cp2077-tweak-xl',
    needs: ['red4ext'],
  },
  {
    id: 'codeware',
    name: 'Codeware',
    short: 'CODEWARE',
    markers: ['red4ext/plugins/codeware/codeware.dll'],
    github: 'psiberx/cp2077-codeware',
    needs: ['red4ext', 'redscript'],
  },
  {
    id: 'inputloader',
    name: 'Input Loader',
    short: 'INPUT LDR',
    markers: ['red4ext/plugins/input_loader/input_loader.dll'],
    github: 'jackhumbert/cyberpunk2077-input-loader',
    needs: ['red4ext'],
  },
  {
    id: 'modsettings',
    name: 'Mod Settings',
    short: 'MOD SET',
    markers: ['red4ext/plugins/mod_settings/mod_settings.dll'],
    github: 'jackhumbert/mod_settings',
    needs: ['red4ext', 'redscript'],
  },
  {
    id: 'nativesettings',
    name: 'Native Settings UI',
    short: 'NATIVE UI',
    markers: ['bin/x64/plugins/cyber_engine_tweaks/mods/nativesettings/init.lua'],
    needs: ['cet'],
  },
  {
    id: 'redmod',
    name: 'REDmod (DLC)',
    short: 'REDMOD',
    markers: ['tools/redmod/bin/redmod.exe'],
    needs: [],
  },
]

export const frameworkById = (id: FrameworkId): FrameworkDef => {
  const def = FRAMEWORKS.find((f) => f.id === id)
  if (!def) throw new Error(`unknown framework ${id}`)
  return def
}
