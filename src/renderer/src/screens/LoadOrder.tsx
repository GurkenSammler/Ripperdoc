import { useMemo } from 'react'
import { t } from '@shared/i18n'
import { useCore } from '../state'
import { Chip, Micro, Panel, SectionHeader } from '../ui/kit'
import { TypeChips } from './parts'

/** Reihenfolge + Dateikonflikte. Ressourcen-Konflikte innerhalb von .archive-Dateien (RDAR-Scan) kommen in Schritt 4. */
export function LoadOrder() {
  const { inv } = useCore()
  const byId = useMemo(() => new Map(inv.mods.map((m) => [m.id, m])), [inv.mods])
  const order = inv.profile.order.map((id) => byId.get(id)).filter((m) => !!m)

  return (
    <div className="page page--split">
      <section>
        <SectionHeader index={1} title={t('inv.order.title')} status={t('inv.order.status')} active />
        <div className="lo-list">
          {order.map((m, i) => (
            <div key={m.id} className={`lo-row${inv.profile.enabled[m.id] ? '' : ' lo-row--off'}`}>
              <span className="row__prio">{String(i + 1).padStart(2, '0')}</span>
              <span className="lo-row__name">{m.name}</span>
              <TypeChips types={m.types} />
            </div>
          ))}
          {order.length === 0 && <Micro>{t('inv.order.none')}</Micro>}
        </div>
      </section>
      <section>
        <SectionHeader index={2} title={t('inv.order.conflicts')} status={`${inv.conflicts.length}`} />
        {inv.conflicts.length === 0 ? (
          <Panel cut={14}>
            <div className="lo-empty">
              <Chip tone="ok">CLEAN</Chip>
              <span className="dim">{t('inv.order.clean')}</span>
            </div>
          </Panel>
        ) : (
          <div className="lo-conflicts">
            {inv.conflicts.map((c) => (
              <div key={c.dst} className="lo-conflict">
                <div className="mono">{c.dst}</div>
                <div>
                  <span className="accent">{byId.get(c.winner)?.name}</span>
                  <span className="dim"> {t('inv.order.winsAgainst')} </span>
                  <span className="alert">{c.losers.map((l) => byId.get(l)?.name).join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <Micro className="lo-note">{t('inv.order.note')}</Micro>
      </section>
    </div>
  )
}
