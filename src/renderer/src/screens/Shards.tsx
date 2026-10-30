import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { t, type TKey } from '@shared/i18n'
import type { ModPlan, PlanEntry, PlanEntryState, ShareOptions } from '@shared/types'
import { play } from '../sfx'
import { fmtBytes, fmtTime, useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader, Switch } from '../ui/kit'

// Auswahl je Plan, überlebt den Tab-Wechsel (der Screen wird dabei neu aufgebaut)
const SELECTIONS = new Map<string, Set<string>>()

/** SHARDS: Nexus-Collections laden, eigene Mod-Liste teilen, geteilte Listen öffnen. Rechts der geladene Plan. */
export function Shards() {
  const { plan } = useCore()
  return (
    <div className="page shards">
      <div className="shards__col">
        <CollectionBox />
        <ShareBox />
        <OpenBox />
      </div>
      <div className="shards__plan">{plan ? <PlanView key={plan.id} /> : <NoPlan />}</div>
    </div>
  )
}

function CollectionBox() {
  const { act, setPlan } = useCore()
  const [input, setInput] = useState('')
  const [working, setWorking] = useState(false)
  const load = async () => {
    if (!input.trim() || working) return
    setWorking(true)
    const p = await act(() => window.rd.loadCollection(input))
    setWorking(false)
    if (!p) return
    play('menu_open')
    setInput('')
    setPlan(p)
  }
  return (
    <>
      <SectionHeader index={1} title={t('shards.coll.title')} status="NEXUS" active />
      <Panel cut={16} className="net__box">
        <p className="dim shards__lead">{t('shards.coll.lead')}</p>
        <div className="uplink__form">
          <input
            className="input"
            placeholder={t('shards.coll.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            spellCheck={false}
          />
          <Btn variant="primary" onClick={load} disabled={!input.trim() || working}>
            {working ? t('shards.coll.loading') : t('shards.coll.load')}
          </Btn>
        </div>
      </Panel>
    </>
  )
}

function ShareBox() {
  const { inv, act, toast } = useCore()
  const [title, setTitle] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const [copied, setCopied] = useState<'code' | 'text' | null>(null)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2200)
    return () => clearTimeout(timer)
  }, [copied])
  const o: ShareOptions = { title, onlyActive }
  const counted = inv.mods.filter((m) => !onlyActive || inv.profile.enabled[m.id])
  const nexus = counted.filter((m) => m.source.nexusModId !== undefined).length
  const local = counted.length - nexus

  const copy = async (what: 'code' | 'text') => {
    const ex = await act(() => window.rd.shareExport(o))
    if (!ex) return
    await act(() => window.rd.copyText(what === 'code' ? ex.code : ex.text))
    setCopied(what)
    toast({ tone: 'ok', title: 'SHARD', body: what === 'code' ? t('shards.share.copiedCode', ex.nexus) : t('shards.share.copiedText', ex.nexus + ex.local) })
  }
  const save = async () => {
    const file = await act(() => window.rd.shareSave(o))
    if (file) toast({ tone: 'ok', title: 'SHARD', body: t('shards.share.saved', file) })
  }

  return (
    <>
      <SectionHeader index={2} title={t('shards.share.title')} status={t('shards.share.status', nexus, local)} />
      <Panel cut={16} className="net__box">
        <p className="dim shards__lead">{t('shards.share.lead')}</p>
        <Micro>{t('shards.share.count', nexus, local)}</Micro>
        <div className="config__row">
          <span className="label">{t('shards.share.name')}</span>
          <input className="input shards__title" placeholder={t('shards.share.namePh')} value={title} onChange={(e) => setTitle(e.target.value)} spellCheck={false} />
        </div>
        <div className="config__row">
          <span className="label">{t('shards.share.onlyActive')}</span>
          <Switch on={onlyActive} onChange={setOnlyActive} />
        </div>
        {nexus === 0 ? (
          <p className="dim">{t('shards.share.empty')}</p>
        ) : (
          <div className="config__buttons">
            <Btn size="small" variant="primary" onClick={() => copy('code')}>
              {copied === 'code' ? t('shards.share.copiedBtn') : t('shards.share.copyCode')}
            </Btn>
            <Btn size="small" onClick={() => copy('text')}>
              {copied === 'text' ? t('shards.share.copiedBtn') : t('shards.share.copyText')}
            </Btn>
            <Btn size="small" onClick={save}>
              {t('shards.share.save')}
            </Btn>
          </div>
        )}
      </Panel>
    </>
  )
}

function OpenBox() {
  const { act, setPlan } = useCore()
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  // Ein Shard fragt bei Nexus nach Bildern und Autoren: kann ein paar Sekunden dauern, nicht doppelt starten
  const open = async (get: () => Promise<ModPlan | null>) => {
    if (working) return
    setWorking(true)
    const p = await act(get)
    setWorking(false)
    if (!p) return
    play('menu_open')
    setCode('')
    setPlan(p)
  }
  return (
    <>
      <SectionHeader index={3} title={t('shards.open.title')} />
      <Panel cut={16} className="net__box">
        <p className="dim shards__lead">{t('shards.open.lead')}</p>
        <textarea className="input shards__code" placeholder={t('shards.open.placeholder')} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
        <div className="config__buttons">
          <Btn size="small" variant="primary" disabled={!code.trim() || working} onClick={() => open(() => window.rd.readShard(code))}>
            {working ? t('shards.coll.loading') : t('shards.open.read')}
          </Btn>
          <Btn size="small" disabled={working} onClick={() => open(() => window.rd.openShardFile())}>
            {t('shards.open.file')}
          </Btn>
        </div>
      </Panel>
    </>
  )
}

function NoPlan() {
  return (
    <Panel cut={22} className="shards__empty" tone="deep">
      <div className="empty__inner">
        <div className="empty__glyph">◇</div>
        <div className="title">No list loaded</div>
        <p className="dim">{t('shards.plan.none')}</p>
      </div>
    </Panel>
  )
}

const STATE_KEY = {
  installed: 'shards.plan.state.installed',
  update: 'shards.plan.state.update',
  older: 'shards.plan.state.older',
  missing: 'shards.plan.state.missing',
  unavailable: 'shards.plan.state.unavailable',
} as const satisfies Record<PlanEntryState, TKey>

type Filter = 'all' | PlanEntryState | 'failed'
const FILTERS: Filter[] = ['all', 'missing', 'update', 'older', 'installed', 'unavailable', 'failed']

const failed = (e: PlanEntry) => e.download?.state === 'error'
const running = (e: PlanEntry) => !!e.download && e.download.state !== 'error'
const matches = (e: PlanEntry, f: Filter) => f === 'all' || (f === 'failed' ? failed(e) : e.state === f)

/** Was gerade mit dem Eintrag los ist: Download vor Zustand. */
function entryChip(e: PlanEntry): { label: string; tone?: 'accent' | 'warn' | 'alert' | 'ok' } {
  if (e.download?.state === 'downloading') return { label: t('shards.plan.state.loading'), tone: 'accent' }
  if (e.download?.state === 'queued' || e.download?.state === 'preparing') return { label: t('shards.plan.state.queued'), tone: 'accent' }
  if (e.download?.state === 'done') return { label: t('shards.plan.state.dialog'), tone: 'warn' }
  if (failed(e)) return { label: t('shards.plan.state.failed'), tone: 'alert' }
  const tone = e.state === 'installed' ? 'ok' : e.state === 'update' ? 'warn' : e.state === 'unavailable' ? 'alert' : undefined
  return { label: t(STATE_KEY[e.state]), tone }
}

// Vorausgewählt wird nur, was fehlt oder wirklich neuer ist; ältere/gleiche Versionen nie (kein stilles Downgrade)
const wanted = (e: PlanEntry) => (e.state === 'missing' || e.state === 'update') && !e.optional
const selectable = (e: PlanEntry) => e.state === 'missing' || e.state === 'update' || e.state === 'older'

function PlanView() {
  const { plan: p0, setPlan, inv, downloads, nexus, act, toast, setInv, go } = useCore()
  const plan = p0!
  const [sel, setSelState] = useState<Set<string>>(() => {
    const first = SELECTIONS.get(plan.id) ?? new Set(plan.entries.filter(wanted).map((e) => e.key))
    SELECTIONS.set(plan.id, first)
    return first
  })
  const setSel = useCallback(
    (next: Set<string>) => {
      SELECTIONS.set(plan.id, next)
      setSelState(next)
    },
    [plan.id],
  )
  const [working, setWorking] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])

  // Nur neu abgleichen, wenn sich ein Download-Zustand ändert (nicht bei jedem Fortschritts-Tick)
  const dlSig = useMemo(() => downloads.map((d) => `${d.id}:${d.state}`).join(','), [downloads])
  useEffect(() => {
    let live = true
    void window.rd.plan(plan.id).then((p) => {
      if (live && p) setPlan(p)
    })
    return () => {
      live = false
    }
  }, [inv, dlSig, plan.id, setPlan])

  const entries = plan.entries
  const have = entries.filter((e) => e.state === 'installed').length
  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f, 0])) as Record<Filter, number>
    for (const e of entries) for (const f of FILTERS) if (matches(e, f)) c[f]++
    return c
  }, [entries])
  const q = search.trim().toLowerCase()
  const shown = entries.filter((e) => matches(e, filter) && (!q || e.modName.toLowerCase().includes(q) || e.fileTitle.toLowerCase().includes(q)))
  const picked = entries.filter((e) => sel.has(e.key) && selectable(e))
  const todo = picked.filter((e) => !running(e))
  const busy = picked.length - todo.length
  const size = todo.reduce((n, e) => n + e.size, 0)
  const premium = !!nexus.user?.premium
  const opened = todo.filter((e) => e.opened).length

  // Liest die Auswahl aus SELECTIONS statt aus dem State: bleibt stabil, damit nicht jede Zeile neu zeichnet
  const toggle = useCallback(
    (key: string, on: boolean) => {
      const next = new Set(SELECTIONS.get(plan.id) ?? [])
      if (on) next.add(key)
      else next.delete(key)
      setSel(next)
    },
    [plan.id, setSel],
  )
  const select = (pred: (e: PlanEntry) => boolean) => {
    play('move')
    setSel(new Set(entries.filter((e) => selectable(e) && pred(e)).map((e) => e.key)))
  }

  const getFiles = useCallback(
    async (keys: string[], force = false) => {
      setWorking(true)
      const run = await act(() => window.rd.planDownload(plan.id, keys, force))
      setWorking(false)
      if (!run) return
      if (run.queued.length) toast({ tone: 'info', title: 'DOWNLOAD', body: t('shards.plan.queuedToast', run.queued.length) })
      if (run.opened) toast({ tone: 'info', title: 'NEXUS', body: t('shards.plan.openedToast', run.opened, run.left) })
      if (run.failed.length) toast({ tone: 'alert', title: 'DOWNLOAD', body: t('shards.plan.failedToast', run.failed.length, `${run.failed[0].name}: ${run.failed[0].error}`) })
      if (!run.queued.length && !run.opened && !run.failed.length) {
        toast({ tone: 'info', title: 'SHARD', body: !premium && keys.length ? t('shards.plan.allOpened') : t('shards.plan.nothingToDo') })
      }
      if (run.queued.length) play('enter')
    },
    [act, plan.id, premium, toast],
  )

  // Reihenfolge übernehmen: zweistufig, mit Angabe, was sich ändert
  const hits = entries.filter((e) => e.state === 'installed' && e.recordId)
  const toggles = hits.filter((e) => e.enabled !== undefined && !!inv.profile.enabled[e.recordId!] !== e.enabled).length
  const applyOrder = async () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    const next = await act(() => window.rd.planApplyOrder(plan.id))
    if (!next) return
    setInv(next)
    toast({ tone: 'ok', title: 'LOAD ORDER', body: t('shards.plan.orderApplied') })
  }

  const close = () => {
    play('menu_close')
    SELECTIONS.delete(plan.id)
    void window.rd.closePlan(plan.id)
    setPlan(null)
  }

  return (
    <Panel cut={22} className="plan" tone="deep">
      <div className="plan__head">
        {plan.picture ? <img className="plan__pic" src={plan.picture} alt="" /> : <div className="plan__pic plan__pic--none micro">{plan.kind.toUpperCase()}</div>}
        <div className="plan__info">
          <Micro accent>
            {plan.kind === 'collection' ? 'NEXUS COLLECTION' : 'RIPPERDOC SHARD'}
            {plan.revision ? ` // ${t('shards.plan.revision', plan.revision)}` : ''}
            {plan.patch ? ` // ${t('shards.plan.sender', plan.patch)}` : ''}
          </Micro>
          <div className="plan__title">{plan.title}</div>
          <div className="chips">
            <Chip tone={have === entries.length ? 'ok' : 'accent'}>{t('shards.plan.summary', have, entries.length)}</Chip>
            {plan.author && <Chip>{t('shards.plan.by', plan.author)}</Chip>}
            {plan.created && <Chip>{fmtTime(plan.created)}</Chip>}
            {plan.adult && (
              <Chip tone="warn" title={t('shards.plan.adultHint')}>
                {t('shards.plan.adult')}
              </Chip>
            )}
          </div>
          {plan.summary && <div className="plan__summary dim">{plan.summary}</div>}
        </div>
        <div className="plan__headbtns">
          {plan.url && (
            <Btn size="small" onClick={() => window.rd.openUrl(plan.url!)}>
              Nexus
            </Btn>
          )}
          <Btn size="small" onClick={close} sfx="menu_close">
            {t('shards.plan.close')}
          </Btn>
        </div>
      </div>

      <div className="plan__filters">
        <input className="input plan__search" placeholder={t('shards.plan.searchPh')} value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
        <div className="seg">
          {FILTERS.filter((f) => f === 'all' || counts[f] > 0).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} onMouseEnter={() => play('hover')}>
              {f === 'all' ? t('shards.plan.filterAll') : f === 'failed' ? t('shards.plan.state.failed') : t(STATE_KEY[f])} {counts[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="plan__bar">
        <div className="seg">
          <button onClick={() => select(wanted)} onMouseEnter={() => play('hover')}>
            {t('shards.plan.selectMissing')}
          </button>
          <button onClick={() => select(() => true)} onMouseEnter={() => play('hover')}>
            {t('shards.plan.selectAll')}
          </button>
          <button onClick={() => select(() => false)} onMouseEnter={() => play('hover')}>
            {t('shards.plan.selectNone')}
          </button>
        </div>
        <span className="dl__spacer" />
        <Micro>{t('shards.plan.counts', picked.length, todo.length, busy, size ? fmtBytes(size) : '')}</Micro>
        {!premium && nexus.hasKey && todo.length > 0 && <Micro className="special">{t('shards.plan.openedCount', opened, todo.length)}</Micro>}
      </div>

      <div className="plan__list">
        {shown.map((e) => (
          <PlanRow
            key={e.key}
            e={e}
            kind={plan.kind}
            checked={selectable(e) && sel.has(e.key)}
            canOpen={selectable(e) && !premium && nexus.hasKey}
            onToggle={toggle}
            onOpen={getFiles}
          />
        ))}
      </div>

      {plan.local.length > 0 && (
        <div className="plan__local">
          <Micro className="special">{t('shards.plan.local', plan.local.length)}</Micro>
          <span className="dim"> {t('shards.plan.localHint')} </span>
          <span>{plan.local.map((l) => (l.version !== '?' ? `${l.name} ${l.version}` : l.name)).join(' · ')}</span>
        </div>
      )}

      <div className="plan__foot">
        <p className="dim plan__hint">{!nexus.hasKey ? t('shards.plan.noKey') : premium ? t('shards.plan.premiumHint') : t('shards.plan.freeHint')}</p>
        <div className="config__buttons">
          {!nexus.hasKey ? (
            <Btn variant="primary" onClick={() => go('net')}>
              NET
            </Btn>
          ) : (
            <Btn variant="primary" onClick={() => getFiles(todo.map((e) => e.key))} disabled={working || todo.length === 0}>
              {premium ? t('shards.plan.download', todo.length) : t('shards.plan.openNext')}
            </Btn>
          )}
          {plan.kind === 'shard' && hits.length > 0 && (
            <Btn onClick={applyOrder} title={t('shards.plan.applyOrderHint')} variant={armed ? 'danger' : undefined} sfx={armed ? 'press' : 'menu_open'}>
              {armed ? t('shards.plan.applyOrderSure', hits.length, toggles) : t('shards.plan.applyOrder')}
            </Btn>
          )}
        </div>
      </div>
      {plan.kind === 'collection' && <p className="dim plan__note">{t('shards.coll.note')}</p>}
    </Panel>
  )
}

/** Eine Zeile des Plans; neu gezeichnet nur, wenn sich an ihr etwas ändert (350er-Listen). */
const PlanRow = memo(
  function PlanRow(props: {
    e: PlanEntry
    kind: ModPlan['kind']
    checked: boolean
    canOpen: boolean
    onToggle: (key: string, on: boolean) => void
    onOpen: (keys: string[], force: boolean) => void
  }) {
    const { e } = props
    const chip = entryChip(e)
    const can = selectable(e)
    return (
      <label className={`pe pe--${e.state}${can ? '' : ' pe--fixed'}`} title={e.state === 'older' ? t('shards.plan.olderHint') : undefined}>
        <input type="checkbox" disabled={!can} checked={props.checked} onChange={(ev) => props.onToggle(e.key, ev.target.checked)} />
        {e.picture ? <img className="pe__pic" src={e.picture} alt="" loading="lazy" /> : <span className="pe__pic pe__pic--none" />}
        <span className="pe__main">
          <button
            className="pe__name"
            title={t('shards.plan.openOne')}
            onClick={(ev) => {
              ev.preventDefault()
              void window.rd.openNexus(e.modId)
            }}
          >
            {e.modName}
          </button>
          <span className="pe__file micro">
            {e.fileTitle && e.fileTitle !== e.modName ? `${e.fileTitle} · ` : ''}V {e.version}
            {e.size ? ` · ${fmtBytes(e.size)}` : ''}
            {e.author ? ` · ${e.author}` : ''}
          </span>
        </span>
        {(e.state === 'update' || e.state === 'older') && e.installedVersion && <Micro className="pe__ver">{t('shards.plan.versions', e.installedVersion, e.version)}</Micro>}
        {e.optional && <Chip>{props.kind === 'shard' ? t('shards.plan.off') : t('shards.plan.optional')}</Chip>}
        {e.adult && <Chip tone="warn">{t('shards.plan.adult')}</Chip>}
        {e.opened && !e.download && e.state !== 'installed' && <Chip>{t('shards.plan.opened')}</Chip>}
        <Chip tone={chip.tone}>{chip.label}</Chip>
        {props.canOpen && (
          <button
            className="pe__open"
            title={t('shards.plan.openOne')}
            onClick={(ev) => {
              ev.preventDefault()
              play('press')
              props.onOpen([e.key], true)
            }}
          >
            ↗
          </button>
        )}
      </label>
    )
  },
  (a, b) =>
    a.checked === b.checked &&
    a.canOpen === b.canOpen &&
    a.kind === b.kind &&
    a.onToggle === b.onToggle &&
    a.onOpen === b.onOpen &&
    a.e.key === b.e.key &&
    a.e.state === b.e.state &&
    a.e.opened === b.e.opened &&
    a.e.installedVersion === b.e.installedVersion &&
    a.e.download?.state === b.e.download?.state,
)
