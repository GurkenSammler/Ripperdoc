// Der Name der App steht nur hier (und in package.json productName), damit ein Umbenennen vor
// einer Veröffentlichung eine Sache von Minuten ist.
export const BRAND = {
  name: 'RIPPERDOC',
  short: 'RDOC',
  dataDirName: 'RipperdocData',
  userAgent: 'Ripperdoc',
} as const

// Steam-App-ID von Cyberpunk 2077 und von Phantom Liberty.
export const STEAM_APP_ID = '1091500'
export const STEAM_PL_DLC_ID = '2138330'
export const GAME_EXE_REL = 'bin/x64/Cyberpunk2077.exe'
export const GAME_PROCESS = 'Cyberpunk2077.exe'

// Öffentliche Statusseite von Nexus Mods (zeigt RIPPERDOC bei Störungen an).
export const NEXUS_STATUS_PAGE = 'https://nexusmods.statuspage.io'

/** "Native Settings UI 1.97" + "1.97" → nicht doppelt anhängen. */
export const withVersion = (name: string, version: string): string =>
  !version || version === '?' || name.includes(version) ? name : `${name} ${version}`
