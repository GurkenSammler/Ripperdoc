import { FRAMEWORKS } from '@shared/frameworks'
import { t } from '@shared/i18n'
import { useCore } from '../state'
import { Chip, Micro, Panel, SectionHeader } from '../ui/kit'

/** Frameworks gegen die Spielversion. Schritt 2 bringt Install/Update aus GitHub und den Update-Wächter. */
export function Cyberware() {
  const { inv, game } = useCore()
  const needed = new Map<string, string[]>()
  for (const m of inv.mods) {
    if (!inv.profile.enabled[m.id]) continue
    for (const r of m.requires) needed.set(r, [...(needed.get(r) ?? []), m.name])
  }
  const providedBy = (id: string) => inv.mods.filter((m) => m.provides.includes(id as never)).map((m) => m.name)

  return (
    <div className="page">
      <SectionHeader index={1} title="Cyberware // Frameworks" status={`GAME BUILD ${game.build || '—'}`} active />
      <p className="dim page__lead">{t('inv.cyber.lead')}</p>
      <div className="fw-grid">
        {FRAMEWORKS.map((f) => {
          const on = inv.installedFrameworks.includes(f.id)
          const need = needed.get(f.id) ?? []
          const by = providedBy(f.id)
          return (
            <Panel key={f.id} className="fw" tone={need.length && !on ? 'alert' : on ? 'accent' : undefined} cut={14}>
              <div className="fw__head">
                <span className="label">{f.name}</span>
                <Chip tone={on ? 'ok' : need.length ? 'alert' : undefined}>{on ? 'ONLINE' : need.length ? t('inv.cyber.missing') : t('inv.cyber.absent')}</Chip>
              </div>
              <Micro>{f.github ? `GITHUB ${f.github}` : f.id === 'redmod' ? t('inv.cyber.steamDlc') : 'NEXUS MODS'}</Micro>
              <div className="fw__body">
                {by.length > 0 && <div className="dim">{t('inv.cyber.installedVia', by.join(', '))}</div>}
                {on && by.length === 0 && <div className="dim">{t('inv.cyber.inGameFolder')}</div>}
                {need.length > 0 && (
                  <div className={on ? 'dim' : 'alert'}>
                    {t('inv.cyber.neededBy', need.length, need.slice(0, 3).join(', '))}
                    {need.length > 3 ? ' …' : ''}
                  </div>
                )}
                {f.needs.length > 0 && <Micro>{t('inv.cyber.needs', f.needs.map((n) => FRAMEWORKS.find((x) => x.id === n)?.short).join(' + '))}</Micro>}
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
