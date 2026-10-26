import type { Lang, LangSetting } from './area'
import { common } from './common'
import { config } from './config'
import { inventory } from './inventory'
import { main } from './main'
import { net } from './net'
import { shell } from './shell'

export type { Lang, LangSetting } from './area'

// Main-Prozess und Oberfläche nutzen dasselbe Wörterbuch, jeder mit seiner eigenen aktuellen Sprache.
export const AREAS = { common, main, inventory, shell, net, config }

const DE = { ...common.de, ...main.de, ...inventory.de, ...shell.de, ...net.de, ...config.de }
const EN: typeof DE = { ...common.en, ...main.en, ...inventory.en, ...shell.en, ...net.en, ...config.en }

export type TKey = keyof typeof DE
type Args<K extends TKey> = (typeof DE)[K] extends (...a: infer A) => string ? A : []

let current: Lang = 'de'

export const setLang = (l: Lang): void => {
  current = l
}
export const getLang = (): Lang => current

/** Text in der aktuellen Sprache. Werte (Zahlen, Namen) gehen als weitere Argumente mit. */
export function t<K extends TKey>(key: K, ...args: Args<K>): string {
  const e = (current === 'en' ? EN : DE)[key] as string | ((...a: Args<K>) => string)
  return typeof e === 'function' ? e(...args) : e
}

/** "auto" folgt der ersten Windows-Sprache: Deutsch bleibt Deutsch, alles andere wird Englisch. */
export const resolveLang = (setting: LangSetting | undefined, locales: readonly string[]): Lang =>
  setting === 'de' || setting === 'en' ? setting : (locales[0] ?? '').toLowerCase().startsWith('de') ? 'de' : 'en'

/** Uhrzeit hh:mm, 24 h in beiden Sprachen. */
export const hhmm = (ms: number): string =>
  new Date(ms).toLocaleTimeString(current === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
