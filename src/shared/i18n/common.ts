import { area } from './area'

// Wörter und Meldungen, die mehrere Bildschirme brauchen. Schlüssel: common.*
export const common = area({
  de: {
    'common.lang.label': 'Sprache',
    'common.lang.auto': 'AUTO',
    'common.lang.hint': (system: string) => `AUTO = WINDOWS-SPRACHE (${system})`,
    'common.error': 'FEHLER',
    'common.cancel': 'Abbrechen',
    'common.close': 'Schließen',
    'common.sure': 'Wirklich?',
  },
  en: {
    'common.lang.label': 'Language',
    'common.lang.auto': 'AUTO',
    'common.lang.hint': (system: string) => `AUTO = WINDOWS LANGUAGE (${system})`,
    'common.error': 'ERROR',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.sure': 'Sure?',
  },
})
