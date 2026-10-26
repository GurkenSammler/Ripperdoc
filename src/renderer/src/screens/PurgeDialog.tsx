import { useState } from 'react'
import type { PurgeReport } from '@shared/types'
import { t } from '@shared/i18n'
import { play } from '../sfx'
import { useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader } from '../ui/kit'

/** PURGE → VANILLA: erst fragen, dann Bericht inkl. Snapshot-Vergleich. */
export function PurgeDialog(props: { state: 'ask' | PurgeReport; onState: (s: 'ask' | PurgeReport | null) => void }) {
  const { act, setInv, inv } = useCore()
  const [working, setWorking] = useState(false)

  const run = async () => {
    setWorking(true)
    const r = await act(() => window.rd.purge())
    setWorking(false)
    if (!r) return
    play(r.vanilla?.identical === false ? 'error' : 'enter')
    setInv(await window.rd.inventory())
    props.onState(r)
  }

  const close = () => {
    play('menu_close')
    props.onState(null)
  }

  if (props.state === 'ask') {
    return (
      <div className="modal-backdrop">
        <Panel className="modal modal--small" tone="alert" cut={22}>
          <Micro className="alert">SYSTEM // FULL PURGE</Micro>
          <div className="title alert modal__title">Purge → Vanilla</div>
          <p>{t('shell.purge.intro', inv.deploy.deployed)}</p>
          <p className="dim">{t('shell.purge.drift')}</p>
          <div className="modal__foot">
            <Btn onClick={close} sfx="menu_close">
              {t('common.cancel')}
            </Btn>
            <Btn variant="danger" onClick={run} disabled={working}>
              {working ? t('shell.purge.working') : t('shell.purge.start')}
            </Btn>
          </div>
        </Panel>
      </div>
    )
  }

  const r = props.state
  const v = r.vanilla
  return (
    <div className="modal-backdrop">
      <Panel className="modal modal--small" tone={v?.identical === false || r.errors.length ? 'alert' : 'accent'} cut={22}>
        <Micro accent>PURGE COMPLETE</Micro>
        <div className="title modal__title">{v?.identical ? t('shell.purge.confirmed') : v ? t('shell.purge.diffsFound') : t('shell.purge.done')}</div>
        <dl className="kv">
          <dt>{t('shell.purge.removed')}</dt>
          <dd>{t('shell.purge.files', r.removed)}</dd>
          <dt>{t('shell.purge.restored')}</dt>
          <dd>{t('shell.purge.files', r.restored)}</dd>
          <dt>{t('shell.purge.kept')}</dt>
          <dd>{t('shell.purge.runtimeFiles', r.drift.length)}</dd>
          <dt>Snapshot</dt>
          <dd>
            {v ? (
              v.identical ? (
                <Chip tone="ok">{t('shell.purge.identical')}</Chip>
              ) : (
                <Chip tone="alert">
                  +{v.added.length} / −{v.removed.length} / ~{v.changed.length}
                </Chip>
              )
            ) : (
              <span className="dim">{t('shell.purge.noSnapshot')}</span>
            )}
          </dd>
        </dl>
        {v && !v.identical && (
          <>
            <SectionHeader index={1} title={t('shell.purge.diffs')} />
            <ul className="filelist filelist--short">
              {[...v.added.map((a) => `+ ${a}`), ...v.removed.map((a) => `− ${a}`), ...v.changed.map((a) => `~ ${a}`)].slice(0, 14).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="dim">{t('shell.purge.diffsHint')}</p>
          </>
        )}
        {r.errors.length > 0 && (
          <ul className="filelist filelist--short alert">
            {r.errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="modal__foot">
          <Btn variant="primary" onClick={close} sfx="menu_close">
            OK
          </Btn>
        </div>
      </Panel>
    </div>
  )
}
