// Bausteine der Übersetzung. Jeder Bereich (Datei in diesem Ordner) hält Deutsch und Englisch nebeneinander.

export type Lang = 'de' | 'en'
export type LangSetting = 'auto' | Lang

/** Ein Text: fest oder mit Werten (Zahlen, Namen, Mehrzahl). */
export type Entry = string | ((...args: never[]) => string)

type Mirror<T> = { [K in keyof T]: T[K] extends string ? string : T[K] }

/**
 * Ein Bereich. Fehlt im Englischen ein Schlüssel, ist einer zu viel oder passen die Werte einer Funktion
 * nicht zusammen, meldet tsc das sofort.
 */
export function area<T extends Record<string, Entry>>(d: { de: T; en: NoInfer<Mirror<T>> }): { de: Mirror<T>; en: Mirror<T> } {
  return d as { de: Mirror<T>; en: Mirror<T> }
}
