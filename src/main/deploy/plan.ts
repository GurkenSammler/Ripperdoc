import type { Conflict, ModRecord, Profile } from '@shared/types'
import { keyOf } from '../util/paths'
import type { Desired } from './deployer'

export interface Plan {
  desired: Map<string, Desired>
  conflicts: Conflict[]
  active: Set<string>
}

/**
 * Gewünschter Zustand aus Profil + Mods. Reihenfolge = Priorität: der weiter oben stehende Mod
 * gewinnt bei gleichem Zielpfad. Gerettete overwrite-Dateien aktiver Mods schlagen alles (das sind
 * Davids eigene Änderungen oder Laufzeitdaten der Mods).
 */
export function planDeployment(
  mods: ModRecord[],
  profile: Profile,
  stagedPath: (modId: string, dst: string) => string,
  overwriteFor: (active: Set<string>) => Desired[],
): Plan {
  const byId = new Map(mods.map((m) => [m.id, m]))
  const desired = new Map<string, Desired>()
  const conflicts = new Map<string, Conflict>()
  const active = new Set<string>()

  for (const id of profile.order) {
    const mod = byId.get(id)
    if (!mod || !profile.enabled[id]) continue
    active.add(id)
    for (const f of mod.files) {
      const k = keyOf(f.dst)
      const have = desired.get(k)
      if (!have) {
        desired.set(k, { dst: f.dst, modId: id, src: stagedPath(id, f.dst) })
        continue
      }
      if (have.modId === id) continue
      const c = conflicts.get(k) ?? { dst: f.dst, winner: have.modId, losers: [] }
      c.losers.push(id)
      conflicts.set(k, c)
    }
  }

  for (const o of overwriteFor(active)) desired.set(keyOf(o.dst), o)

  return { desired, conflicts: [...conflicts.values()], active }
}
