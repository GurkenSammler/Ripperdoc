import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { JournalEntry } from '@shared/types'

// Jede Änderung am Spielordner wird hier notiert, BEVOR sie passiert (eine Zeile JSON je Schritt).
// Damit lässt sich nach einem Absturz nachvollziehen, was zuletzt geschehen ist.
export class Journal {
  constructor(private readonly dir: string) {}

  private file(date = new Date()): string {
    return path.join(this.dir, `${date.toISOString().slice(0, 10)}.jsonl`)
  }

  async write(entry: Omit<JournalEntry, 't'>): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry })
    await fs.appendFile(this.file(), line + '\n', 'utf8')
  }

  /** Die letzten `limit` Einträge, neueste zuerst. */
  async tail(limit = 200): Promise<JournalEntry[]> {
    let names: string[]
    try {
      names = (await fs.readdir(this.dir)).filter((n) => n.endsWith('.jsonl')).sort().reverse()
    } catch {
      return []
    }
    const out: JournalEntry[] = []
    for (const name of names) {
      const lines = (await fs.readFile(path.join(this.dir, name), 'utf8')).split('\n').filter(Boolean).reverse()
      for (const line of lines) {
        try {
          out.push(JSON.parse(line) as JournalEntry)
        } catch {
          // kaputte Zeile (Absturz mitten im Schreiben) überspringen
        }
        if (out.length >= limit) return out
      }
    }
    return out
  }
}
