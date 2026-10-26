import { useEffect, useState } from 'react'
import type { JournalEntry } from '@shared/types'
import { t } from '@shared/i18n'
import { fmtTime, useCore } from '../state'
import { Btn, Chip, Micro, SectionHeader } from '../ui/kit'

const TONE: Record<string, 'accent' | 'warn' | 'alert' | 'ok' | undefined> = {
  link: 'accent',
  unlink: undefined,
  backup: 'warn',
  restore: 'ok',
  rescue: 'warn',
  purge: 'alert',
  snapshot: 'ok',
  install: 'accent',
  uninstall: 'alert',
  launch: 'ok',
  'restore-cache': 'ok',
  'cache-extra': 'warn',
  enable: 'ok',
  disable: undefined,
  move: 'accent',
  redeploy: 'ok',
}

/** Änderungsprotokoll. Schritt 6 ergänzt die Auswertung der Spiel-Logs und den Bisect-Assistenten. */
export function Journal() {
  const { inv } = useCore()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [ops, setOps] = useState<'all' | 'main'>('main')

  const load = () => void window.rd.journal(600).then(setEntries)
  useEffect(load, [inv])

  const shown = ops === 'all' ? entries : entries.filter((e) => !['link', 'unlink', 'mkdir', 'rmdir'].includes(e.op))

  return (
    <div className="page">
      <SectionHeader index={1} title={t('shell.journal.title')} status={t('shell.journal.entries', entries.length)} active />
      <div className="toolbar">
        <div className="seg">
          <button className={ops === 'main' ? 'on' : ''} onClick={() => setOps('main')}>
            {t('shell.journal.filterMain')}
          </button>
          <button className={ops === 'all' ? 'on' : ''} onClick={() => setOps('all')}>
            {t('shell.journal.filterAll')}
          </button>
        </div>
        <span className="toolbar__spacer" />
        <Btn size="small" onClick={load}>
          {t('shell.journal.reload')}
        </Btn>
      </div>
      <div className="journal">
        {shown.map((e, i) => (
          <div key={i} className="journal__row">
            <span className="micro">{fmtTime(e.t)}</span>
            <Chip tone={TONE[e.op]}>{e.op}</Chip>
            <span className="mono journal__path">{e.path ?? e.note ?? ''}</span>
            <span className="micro">{e.mod ?? ''}</span>
          </div>
        ))}
        {shown.length === 0 && <Micro>{t('shell.journal.empty')}</Micro>}
      </div>
      <Micro className="lo-note">{t('shell.journal.later')}</Micro>
    </div>
  )
}
