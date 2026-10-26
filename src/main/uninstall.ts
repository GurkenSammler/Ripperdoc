import type { Core } from './core'

// Der Deinstaller (NSIS) ruft "RIPPERDOC.exe --uninstall" auf, bevor er Dateien löscht. Liegen noch Mods im
// Spielordner, fragt RIPPERDOC, ob es vorher alles zurück auf vanilla setzen soll (PURGE). Der Datenordner
// (Mods, Sicherungen, Einstellungen) bleibt in jedem Fall liegen.

export const UNINSTALL_CONTINUE = 0
export const UNINSTALL_ABORT = 2

export type UninstallChoice = 'purge' | 'keep' | 'cancel'

export interface UninstallUi {
  /** Mods sind eingebunden: zurücksetzen, so lassen oder Deinstallation abbrechen? */
  ask(deployedFiles: number): Promise<UninstallChoice>
  /** PURGE ist gescheitert (z. B. Spiel läuft): trotzdem deinstallieren? */
  failed(message: string): Promise<boolean>
}

/** Ergebnis ist der Exit-Code für den Deinstaller: 0 = weitermachen, 2 = abbrechen. */
export async function uninstallCleanup(core: Core, ui: UninstallUi): Promise<number> {
  const deployed = core.deployedFiles()
  if (deployed === 0) return UNINSTALL_CONTINUE
  const choice = await ui.ask(deployed)
  if (choice === 'cancel') return UNINSTALL_ABORT
  if (choice === 'keep') return UNINSTALL_CONTINUE
  try {
    const report = await core.purge()
    if (report.errors.length === 0) return UNINSTALL_CONTINUE
    return (await ui.failed(report.errors.slice(0, 3).join('\n'))) ? UNINSTALL_CONTINUE : UNINSTALL_ABORT
  } catch (err) {
    return (await ui.failed((err as Error).message)) ? UNINSTALL_CONTINUE : UNINSTALL_ABORT
  }
}
