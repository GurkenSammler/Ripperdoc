import { area } from './area'

// Rahmen (App), Boot, JOURNAL, PURGE-Dialog. Schlüssel: shell.*
export const shell = area({
  de: {
    // Start
    'shell.start.failed': (err: string) => `START FEHLGESCHLAGEN: ${err}`,

    // Meldungen
    'shell.toast.importFailed': 'IMPORT FEHLGESCHLAGEN',
    'shell.toast.sessionEnded': 'Session beendet.',
    'shell.toast.launchVanilla': 'Start ohne Mods (VANILLA MODE).',
    'shell.toast.launchMods': 'Mods sind eingespielt, das Spiel startet.',
    'shell.toast.redeployed': (n: number) => (n === 1 ? '1 Datei eingespielt.' : `${n} Dateien eingespielt.`),

    // Kopfzeile, Hinweisleisten, Drop-Fläche
    'shell.nexus.outage': 'NEXUS GESTÖRT',
    'shell.banner.vanilla': 'Mods sind gerade nicht im Spielordner. Schalter ändern nur die Auswahl.',
    'shell.banner.updated': (from: string, to: string) =>
      `Build ${from} → ${to}. Frameworks wie RED4ext oder ArchiveXL können jetzt kaputt sein.`,
    'shell.banner.checkCyberware': 'Cyberware prüfen',
    'shell.drop.formats': 'ZIP · 7Z · RAR · .ARCHIVE · ORDNER',

    // JOURNAL
    'shell.journal.title': 'Journal // Änderungen am Spielordner',
    'shell.journal.entries': (n: number) => (n === 1 ? '1 EINTRAG' : `${n} EINTRÄGE`),
    'shell.journal.filterMain': 'WICHTIGES',
    'shell.journal.filterAll': 'JEDE DATEI',
    'shell.journal.reload': 'Neu laden',
    'shell.journal.empty': 'NOCH NICHTS PASSIERT',
    'shell.journal.later': 'LOG-ANALYSE NACH SPIELENDE + CRASH-BISECT // SCHRITT 6',

    // PURGE
    'shell.purge.intro': (n: number) =>
      `Nimmt ${n === 1 ? 'die 1 Datei' : `alle ${n} Dateien`} von RIPPERDOC aus dem Spielordner, legt gesicherte Spieldateien zurück und setzt den Script-Cache auf den Snapshot. Deine Auswahl bleibt erhalten; mit RE-DEPLOY ist alles wieder da.`,
    'shell.purge.drift': 'Dateien, die Mods zur Laufzeit angelegt haben (Einstellungen, Logs), werden nicht gelöscht, sondern im Datenordner aufgehoben.',
    'shell.purge.working': 'Läuft…',
    'shell.purge.start': 'Purge starten',
    'shell.purge.confirmed': 'Vanilla bestätigt',
    'shell.purge.diffsFound': 'Abweichungen gefunden',
    'shell.purge.done': 'Purge fertig',
    'shell.purge.removed': 'Entfernt',
    'shell.purge.restored': 'Zurückgelegt',
    'shell.purge.kept': 'Aufgehoben',
    'shell.purge.files': (n: number) => (n === 1 ? '1 Datei' : `${n} Dateien`),
    'shell.purge.runtimeFiles': (n: number) => (n === 1 ? '1 Laufzeitdatei' : `${n} Laufzeitdateien`),
    'shell.purge.identical': 'IDENTISCH MIT DEM ZUSTAND VOR DEM ERSTEN DEPLOY',
    'shell.purge.noSnapshot': 'noch keiner (es wurde nie etwas eingespielt)',
    'shell.purge.diffs': 'Abweichungen',
    'shell.purge.diffsHint': '„+“ sind meist Dateien, die außerhalb von RIPPERDOC hinzugekommen sind. „~“ nach einem Spiel-Update: Steam „Dateien überprüfen“.',
  },
  en: {
    // Start
    'shell.start.failed': (err: string) => `START FAILED: ${err}`,

    // Meldungen
    'shell.toast.importFailed': 'IMPORT FAILED',
    'shell.toast.sessionEnded': 'Session ended.',
    'shell.toast.launchVanilla': 'Starting without mods (VANILLA MODE).',
    'shell.toast.launchMods': 'Mods deployed, the game is starting.',
    'shell.toast.redeployed': (n: number) => (n === 1 ? '1 file deployed.' : `${n} files deployed.`),

    // Kopfzeile, Hinweisleisten, Drop-Fläche
    'shell.nexus.outage': 'NEXUS OUTAGE',
    'shell.banner.vanilla': 'Mods are not in the game folder right now. Toggles only change the selection.',
    'shell.banner.updated': (from: string, to: string) =>
      `Build ${from} → ${to}. Frameworks like RED4ext or ArchiveXL may be broken now.`,
    'shell.banner.checkCyberware': 'Check Cyberware',
    'shell.drop.formats': 'ZIP · 7Z · RAR · .ARCHIVE · FOLDER',

    // JOURNAL
    'shell.journal.title': 'Journal // Game folder changes',
    'shell.journal.entries': (n: number) => (n === 1 ? '1 ENTRY' : `${n} ENTRIES`),
    'shell.journal.filterMain': 'IMPORTANT',
    'shell.journal.filterAll': 'EVERY FILE',
    'shell.journal.reload': 'Reload',
    'shell.journal.empty': 'NOTHING HAPPENED YET',
    'shell.journal.later': 'LOG ANALYSIS AFTER GAME EXIT + CRASH BISECT // STEP 6',

    // PURGE
    'shell.purge.intro': (n: number) =>
      `Takes ${n === 1 ? 'the 1 RIPPERDOC file' : `all ${n} RIPPERDOC files`} out of the game folder, puts backed-up game files back and resets the script cache to the snapshot. Your selection is kept; RE-DEPLOY brings everything back.`,
    'shell.purge.drift': 'Files that mods created at runtime (settings, logs) are not deleted but kept in the data folder.',
    'shell.purge.working': 'Running…',
    'shell.purge.start': 'Start purge',
    'shell.purge.confirmed': 'Vanilla confirmed',
    'shell.purge.diffsFound': 'Differences found',
    'shell.purge.done': 'Purge done',
    'shell.purge.removed': 'Removed',
    'shell.purge.restored': 'Restored',
    'shell.purge.kept': 'Kept',
    'shell.purge.files': (n: number) => (n === 1 ? '1 file' : `${n} files`),
    'shell.purge.runtimeFiles': (n: number) => (n === 1 ? '1 runtime file' : `${n} runtime files`),
    'shell.purge.identical': 'MATCHES THE STATE BEFORE THE FIRST DEPLOY',
    'shell.purge.noSnapshot': 'none yet (nothing was ever deployed)',
    'shell.purge.diffs': 'Differences',
    'shell.purge.diffsHint': '“+” are mostly files added outside of RIPPERDOC. “~” after a game update: Steam “Verify integrity of game files”.',
  },
})
