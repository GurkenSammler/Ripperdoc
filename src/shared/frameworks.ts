import type { FrameworkId } from './types'

export interface FrameworkDef {
  id: FrameworkId
  name: string
  short: string // Chip-Text in der Oberfläche
  // Eine dieser Dateien (relativ zur Spielwurzel, klein geschrieben) zeigt: das Framework ist da.
  markers: string[]
  github?: string // owner/repo der offiziellen Releases (Schritt 2)
  nexusId?: number // Mod-ID auf Nexus: Requirements anderer Mods zeigen darauf
  needs: FrameworkId[] // worauf das Framework selbst aufbaut
}

export const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'cet',
    name: 'Cyber Engine Tweaks',
    short: 'CET',
    markers: ['bin/x64/plugins/cyber_engine_tweaks.asi'],
    github: 'maximegmd/CyberEngineTweaks',
    nexusId: 107,
    needs: [],
  },
  {
    id: 'red4ext',
    name: 'RED4ext',
    short: 'RED4EXT',
    markers: ['red4ext/red4ext.dll'],
    github: 'wopss/RED4ext',
    nexusId: 2380,
    needs: [],
  },
  {
    id: 'redscript',
    name: 'redscript',
    short: 'REDSCRIPT',
    markers: ['engine/tools/scc.exe', 'engine/tools/scc_lib.dll'],
    github: 'jac3km4/redscript',
    nexusId: 1511,
    needs: [],
  },
  {
    id: 'archivexl',
    name: 'ArchiveXL',
    short: 'ARCHIVEXL',
    markers: ['red4ext/plugins/archivexl/archivexl.dll'],
    github: 'psiberx/cp2077-archive-xl',
    nexusId: 4198,
    needs: ['red4ext'],
  },
  {
    id: 'tweakxl',
    name: 'TweakXL',
    short: 'TWEAKXL',
    markers: ['red4ext/plugins/tweakxl/tweakxl.dll'],
    github: 'psiberx/cp2077-tweak-xl',
    nexusId: 4197,
    needs: ['red4ext'],
  },
  {
    id: 'codeware',
    name: 'Codeware',
    short: 'CODEWARE',
    markers: ['red4ext/plugins/codeware/codeware.dll'],
    github: 'psiberx/cp2077-codeware',
    nexusId: 7780,
    needs: ['red4ext', 'redscript'],
  },
  {
    id: 'inputloader',
    name: 'Input Loader',
    short: 'INPUT LDR',
    markers: ['red4ext/plugins/input_loader/input_loader.dll'],
    github: 'jackhumbert/cyberpunk2077-input-loader',
    nexusId: 4575,
    needs: ['red4ext'],
  },
  {
    id: 'modsettings',
    name: 'Mod Settings',
    short: 'MOD SET',
    markers: ['red4ext/plugins/mod_settings/mod_settings.dll'],
    github: 'jackhumbert/mod_settings',
    nexusId: 4885,
    needs: ['red4ext', 'redscript'],
  },
  {
    id: 'nativesettings',
    name: 'Native Settings UI',
    short: 'NATIVE UI',
    markers: ['bin/x64/plugins/cyber_engine_tweaks/mods/nativesettings/init.lua'],
    nexusId: 3518,
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
