import { area } from './area'

// SYS.CONFIG. Schlüssel: config.*
export const config = area({
  de: {
    // Spielordner wechseln
    'config.root.restartTitle': 'NEUSTART',
    'config.root.restartBody': 'Spiel gefunden. Die Mod-Daten kommen aufs Laufwerk des Spiels, RIPPERDOC startet neu.',
    'config.root.toastTitle': 'SPIELORDNER',

    // Look
    'config.look.theme': 'Farbschema',

    // Audio
    'config.audio.sounds': 'UI-Sounds',
    'config.audio.volume': 'Lautstärke',

    // Launch
    'config.launch.via': 'Start über',
    'config.launch.direct': 'EXE DIREKT',
    'config.launch.storeOnlyExe': (store: string) => `${store}-Fassung: Start immer über die exe`,
    'config.launch.skipIntro': 'Intro überspringen',
    'config.launch.skipIntroSteam': 'NUR BEI EXE DIREKT (STEAM FRAGT SONST JEDES MAL NACH)',

    // Pfade
    'config.paths.title': 'Pfade',
    'config.paths.game': 'Spiel',
    'config.paths.source': 'Quelle',
    'config.paths.manual': 'manuell gesetzt',
    'config.paths.auto': (store: string) => `automatisch (${store})`,
    'config.paths.data': 'Daten',
    'config.paths.drive': 'Laufwerk',
    'config.paths.sameDrive': 'GLEICHES LAUFWERK → HARDLINKS',
    'config.paths.otherDrive': 'ANDERES LAUFWERK → KOPIEN',
    'config.paths.pickRoot': 'Spielordner wählen…',
    'config.paths.autoRoot': 'Automatisch suchen',
    'config.paths.openGame': 'Spielordner öffnen',
    'config.paths.openData': 'Datenordner',

    // Wartung
    'config.maint.title': 'Wartung',
    'config.maint.verify': 'Spielordner prüfen',
    'config.maint.replayBoot': 'Boot abspielen',
    'config.maint.linksOk': (n: number) => (n === 1 ? '1 LINK OK' : `${n} LINKS OK`),
    'config.maint.missing': (n: number) => (n === 1 ? '1 FEHLT' : `${n} FEHLEN`),
    'config.maint.replaced': (n: number) => `${n} GEÄNDERT`,
    'config.maint.unmanaged': (n: number) => `${n} FREMD`,
    'config.maint.unmanagedHint': 'Dateien in Mod-Ordnern, die weder RIPPERDOC noch dem Spiel gehören (manuell installiert oder zur Laufzeit erzeugt):',
    'config.maint.autoRepair': 'Der nächste Schalter oder LAUNCH repariert das automatisch.',

    // Installieren + Downloads-Ordner
    'config.install.title': 'Installieren',
    'config.install.quick': 'Schnell-Installieren',
    'config.install.quickHint':
      'Nexus-Downloads ohne Dialog installieren, wenn nichts zu entscheiden ist (eine Fassung, nichts Unbekanntes). Collections und Requirements machen das immer.',
    'config.install.archives': 'Archive',
    'config.install.usage': (files: number, size: string) => `${files === 1 ? '1 Archiv' : `${files} Archive`} · ${size}`,
    'config.install.unused': (files: number, size: string) => `${files === 1 ? '1 ungenutztes' : `${files} ungenutzte`} · ${size}`,
    'config.install.clean': 'Ungenutzte löschen',
    'config.install.cleanHint': 'Archive, die zu keinem installierten Mod mehr gehören (nach Entfernen oder Updates)',
    'config.install.cleaned': (size: string) => `${size} freigegeben.`,
    'config.install.cleanTitle': 'AUFGERÄUMT',
    'config.install.cleanSure': (size: string) => `Wirklich ${size} löschen?`,
    'config.install.openDownloads': 'Ordner',

    // About
    'config.about.note': 'Hinweis',
    'config.about.disclaimer':
      'Inoffizielles Fan-Projekt, nicht von CD PROJEKT RED genehmigt oder unterstützt. „Cyberpunk 2077“ ist eine Marke von CD PROJEKT S.A., die UI-Sounds stammen aus dem Spiel (© CD PROJEKT S.A.). Kostenlos, nicht kommerziell.',
  },
  en: {
    'config.root.restartTitle': 'RESTART',
    'config.root.restartBody': 'Game found. Mod data moves to the game’s drive, RIPPERDOC restarts.',
    'config.root.toastTitle': 'GAME FOLDER',

    'config.look.theme': 'Color scheme',

    'config.audio.sounds': 'UI sounds',
    'config.audio.volume': 'Volume',

    'config.launch.via': 'Launch via',
    'config.launch.direct': 'EXE DIRECT',
    'config.launch.storeOnlyExe': (store: string) => `${store} version: always launches via the exe`,
    'config.launch.skipIntro': 'Skip intro',
    'config.launch.skipIntroSteam': 'EXE DIRECT ONLY (OTHERWISE STEAM ASKS EVERY TIME)',

    'config.paths.title': 'Paths',
    'config.paths.game': 'Game',
    'config.paths.source': 'Source',
    'config.paths.manual': 'set manually',
    'config.paths.auto': (store: string) => `automatic (${store})`,
    'config.paths.data': 'Data',
    'config.paths.drive': 'Drive',
    'config.paths.sameDrive': 'SAME DRIVE → HARDLINKS',
    'config.paths.otherDrive': 'OTHER DRIVE → COPIES',
    'config.paths.pickRoot': 'Choose game folder…',
    'config.paths.autoRoot': 'Auto-detect',
    'config.paths.openGame': 'Open game folder',
    'config.paths.openData': 'Data folder',

    'config.maint.title': 'Maintenance',
    'config.maint.verify': 'Verify game folder',
    'config.maint.replayBoot': 'Replay boot',
    'config.maint.linksOk': (n: number) => (n === 1 ? '1 LINK OK' : `${n} LINKS OK`),
    'config.maint.missing': (n: number) => `${n} MISSING`,
    'config.maint.replaced': (n: number) => `${n} CHANGED`,
    'config.maint.unmanaged': (n: number) => `${n} UNMANAGED`,
    'config.maint.unmanagedHint': 'Files in mod folders that belong to neither RIPPERDOC nor the game (installed manually or created at runtime):',
    'config.maint.autoRepair': 'The next toggle or LAUNCH fixes this automatically.',

    'config.install.title': 'Install',
    'config.install.quick': 'Quick install',
    'config.install.quickHint':
      'Install Nexus downloads without the dialog when there is nothing to decide (one variant, nothing unknown). Collections and requirements always do this.',
    'config.install.archives': 'Archives',
    'config.install.usage': (files: number, size: string) => `${files === 1 ? '1 archive' : `${files} archives`} · ${size}`,
    'config.install.unused': (files: number, size: string) => `${files} unused · ${size}`,
    'config.install.clean': 'Delete unused',
    'config.install.cleanHint': 'Archives that no longer belong to an installed mod (after removing or updating)',
    'config.install.cleaned': (size: string) => `${size} freed.`,
    'config.install.cleanTitle': 'CLEANED UP',
    'config.install.cleanSure': (size: string) => `Really delete ${size}?`,
    'config.install.openDownloads': 'Folder',

    'config.about.note': 'Note',
    'config.about.disclaimer':
      'This is an unofficial fan work and is not approved/endorsed by CD PROJEKT RED. “Cyberpunk 2077” is a trademark of CD PROJEKT S.A.; the UI sounds come from the game (© CD PROJEKT S.A.). Free, non-commercial.',
  },
})
