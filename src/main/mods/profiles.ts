import path from 'node:path'
import type { Profile } from '@shared/types'
import { readJson, safeName, writeJson } from '../util/paths'

export const DEFAULT_PROFILE = 'Default'

export class ProfileStore {
  profile: Profile = { name: DEFAULT_PROFILE, order: [], enabled: {} }

  constructor(private readonly dataRoot: string) {}

  private file(name: string): string {
    return path.join(this.dataRoot, 'profiles', `${safeName(name)}.json`)
  }

  async load(name = DEFAULT_PROFILE): Promise<void> {
    this.profile = await readJson<Profile>(this.file(name), { name, order: [], enabled: {} })
  }

  async save(): Promise<void> {
    await writeJson(this.file(this.profile.name), this.profile)
  }

  /** Reihenfolge an die vorhandenen Mods anpassen: Unbekanntes raus, Neues nach oben (höchste Priorität). */
  sync(modIds: string[]): boolean {
    const known = new Set(modIds)
    const before = JSON.stringify(this.profile)
    const order = this.profile.order.filter((id) => known.has(id))
    const fresh = modIds.filter((id) => !order.includes(id))
    this.profile.order = [...fresh, ...order]
    for (const id of Object.keys(this.profile.enabled)) if (!known.has(id)) delete this.profile.enabled[id]
    return JSON.stringify(this.profile) !== before
  }

  setEnabled(id: string, on: boolean): void {
    this.profile.enabled[id] = on
  }

  move(id: string, toIndex: number): void {
    const order = this.profile.order.filter((x) => x !== id)
    order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, id)
    this.profile.order = order
  }

  /** Neuer Mod übernimmt Platz und Schalter des alten (Update). */
  replace(oldId: string, newId: string): void {
    const order = this.profile.order.filter((x) => x !== newId)
    const at = order.indexOf(oldId)
    if (at >= 0) order[at] = newId
    else order.unshift(newId)
    this.profile.order = order
    this.profile.enabled[newId] = this.profile.enabled[oldId] ?? true
    delete this.profile.enabled[oldId]
  }

  add(id: string, enabled: boolean): void {
    this.profile.order = [id, ...this.profile.order.filter((x) => x !== id)]
    this.profile.enabled[id] = enabled
  }
}
