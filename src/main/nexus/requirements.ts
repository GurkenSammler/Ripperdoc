import { readJson, writeJson } from '../util/paths'
import type { NexusClient } from './client'
import { fetchRequirements, type RawRequirement } from './graph'

// Requirements von den Nexus-Seiten, zwischengespeichert in <dataRoot>/nexus-requirements.json.
// Das Inventar rechnet nur mit dem Cache (kein Netz beim Anzeigen); aufgefrischt wird nach dem Start,
// nach einem Import und auf Knopfdruck.

const TTL = 24 * 60 * 60 * 1000

interface Entry {
  at: number
  list: RawRequirement[]
}

// "Optional", "only for …", "if you want …": Autoren schreiben das in die Notiz, Nexus hat kein eigenes Feld dafür
const OPTIONAL =
  /\boptional|\boptionnel|\bopcional|\bopzionale|\bnot (strictly )?(required|needed|necessary)|\bonly (if|for|when|needed)|\bif you (want|use|have|need)|\bnicht (zwingend|nötig|notwendig|erforderlich)|\bnur (für|wenn)\b/i

// "NOT optional", "non-optional", "nicht optional": genau das Gegenteil
const NOT_OPTIONAL = /\b(not|non|nicht|kein)[\s-]+optional/i

export const isOptionalNote = (notes: string): boolean => OPTIONAL.test(notes) && !NOT_OPTIONAL.test(notes)

export class RequirementsCache {
  private data: Record<string, Entry> = {}
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly ttl = TTL,
  ) {}

  async load(): Promise<void> {
    this.data = await readJson<Record<string, Entry>>(this.file, {})
    this.loaded = true
  }

  get(modId: number): RawRequirement[] | null {
    return this.data[modId]?.list ?? null
  }

  private stale(modId: number): boolean {
    const e = this.data[modId]
    return !e || Date.now() - e.at > this.ttl
  }

  /**
   * Fehlende oder alte Einträge holen (force: alle angefragten). Fehler gehen an den Aufrufer.
   * quick: jemand wartet im Dialog darauf, also kurzes Zeitlimit statt Wiederholungen.
   */
  async ensure(client: NexusClient, modIds: number[], force = false, quick = false): Promise<void> {
    if (!this.loaded) await this.load()
    const todo = [...new Set(modIds)].filter((id) => force || this.stale(id))
    if (!todo.length) return
    const fresh = await fetchRequirements(client, todo, quick)
    const now = Date.now()
    for (const [id, list] of fresh) this.data[id] = { at: now, list }
    await writeJson(this.file, this.data)
  }
}
