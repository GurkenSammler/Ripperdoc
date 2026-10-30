import { withVersion } from '@shared/brand'
import { useEffect, useMemo, useState } from 'react'
import { frameworkById } from '@shared/frameworks'
import { t } from '@shared/i18n'
import type { MissingNexus, ModRecord, UpdateInfo } from '@shared/types'
import { play } from '../sfx'
import { fmtBytes, fmtTime, MOD_DRAG, useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader, Switch, useGlitch } from '../ui/kit'
import { TypeChips } from './parts'
import { getRequirements, ReqList, ReqStatus, useRequirements } from './Requirements'

type Filter = 'all' | 'active' | 'issues'

export function Inventory() {
  const { inv, setInv, act, startImport, toast } = useCore()
  const [selected, setSelected] = useState<string | null>(inv.profile.order[0] ?? null)
  // Mehrfachauswahl (Strg/Umschalt+Klick); selected bleibt der Anker
  const [multi, setMulti] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const byId = useMemo(() => new Map(inv.mods.map((m) => [m.id, m])), [inv.mods])
  const conflictsOf = useMemo(() => {
    const wins = new Map<string, number>()
    const loses = new Map<string, number>()
    for (const c of inv.conflicts) {
      wins.set(c.winner, (wins.get(c.winner) ?? 0) + 1)
      for (const l of c.losers) loses.set(l, (loses.get(l) ?? 0) + 1)
    }
    return { wins, loses }
  }, [inv.conflicts])
  const missingOf = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const d of inv.missing) m.set(d.modId, [...(m.get(d.modId) ?? []), frameworkById(d.framework).short])
    return m
  }, [inv.missing])
  const needsOf = useMemo(() => {
    const m = new Map<string, MissingNexus[]>()
    for (const d of inv.missingNexus) m.set(d.modId, [...(m.get(d.modId) ?? []), d])
    return m
  }, [inv.missingNexus])

  const ordered = inv.profile.order.map((id) => byId.get(id)).filter((m): m is ModRecord => !!m)
  const q = search.trim().toLowerCase()
  const visible = ordered.filter((m) => {
    // Suche: Name, Autor oder Nexus-ID
    if (q && !m.name.toLowerCase().includes(q) && !(m.nexus?.author ?? '').toLowerCase().includes(q) && String(m.source.nexusModId ?? '') !== q) return false
    if (filter === 'active') return !!inv.profile.enabled[m.id]
    if (filter === 'issues') return missingOf.has(m.id) || needsOf.has(m.id) || conflictsOf.loses.has(m.id) || !!inv.updates[m.id]?.hasUpdate
    return true
  })

  useEffect(() => {
    if (selected && !byId.has(selected)) setSelected(inv.profile.order[0] ?? null)
    setMulti((s) => {
      const keep = [...s].filter((id) => byId.has(id))
      return keep.length === s.size ? s : new Set(keep)
    })
  }, [byId, selected, inv.profile.order])

  /** Klick auf eine Zeile: allein wählen, Strg = dazu/weg, Umschalt = Bereich ab dem Anker (in der sichtbaren Liste). */
  const choose = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e.shiftKey && selected) {
      const ids = visible.map((m) => m.id)
      const a = ids.indexOf(selected)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        play('move')
        setMulti(new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)))
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      play('move')
      const next = new Set(multi.size ? multi : selected ? [selected] : [])
      if (next.has(id)) {
        next.delete(id)
        // Abgewählt: der aktuelle Mod soll einer der noch gewählten sein, nicht der gerade abgewählte
        setSelected([...next].pop() ?? null)
      } else {
        next.add(id)
        setSelected(id)
      }
      setMulti(next)
      return
    }
    if (id !== selected || multi.size > 1) play('enter')
    setSelected(id)
    setMulti(new Set())
  }
  const bulk = multi.size > 1 ? ordered.filter((m) => multi.has(m.id)) : []

  // Esc hebt die Mehrfachauswahl auf, Strg+A wählt alle sichtbaren (nicht in Eingabefeldern)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox')) return
      if (e.key === 'Escape' && multi.size > 1) {
        play('menu_close')
        setMulti(new Set())
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && visible.length) {
        e.preventDefault()
        play('move')
        setMulti(new Set(visible.map((m) => m.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toggle = async (m: ModRecord, on: boolean) => {
    const next = await act(() => window.rd.setEnabled(m.id, on))
    if (next) setInv(next)
  }

  const moveTo = async (id: string, index: number) => {
    play('move')
    const next = await act(() => window.rd.move(id, index))
    if (next) setInv(next)
  }

  const active = ordered.filter((m) => inv.profile.enabled[m.id]).length
  const sel = selected ? byId.get(selected) : undefined

  return (
    <div className="inv">
      <section className="inv__list">
        <SectionHeader index={1} title="Installed Implants" status={t('inv.list.status', active, ordered.length)} active />
        <div className="toolbar">
          <input
            className="input toolbar__search"
            placeholder={t('inv.list.searchPh')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            spellCheck={false}
          />
          <div className="seg">
            {(['all', 'active', 'issues'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)} onMouseEnter={() => play('hover')}>
                {f === 'all' ? t('inv.list.filter.all') : f === 'active' ? t('inv.list.filter.active') : t('inv.list.filter.issues')}
              </button>
            ))}
          </div>
          <span className="toolbar__spacer" />
          <Btn onClick={() => void window.rd.pickFiles().then(startImport)} sfx="menu_open">
            + Install
          </Btn>
        </div>

        {ordered.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            className="rows"
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(MOD_DRAG)) e.preventDefault()
            }}
          >
            {visible.map((m) => {
              const index = inv.profile.order.indexOf(m.id)
              return (
                <ModRow
                  key={m.id}
                  mod={m}
                  index={index}
                  on={!!inv.profile.enabled[m.id]}
                  selected={bulk.length ? multi.has(m.id) : m.id === selected}
                  wins={conflictsOf.wins.get(m.id) ?? 0}
                  loses={conflictsOf.loses.get(m.id) ?? 0}
                  missing={missingOf.get(m.id) ?? []}
                  needs={needsOf.get(m.id) ?? []}
                  update={inv.updates[m.id]}
                  dropBefore={dropAt === index && dragId !== null && dragId !== m.id}
                  onSelect={(e) => choose(m.id, e)}
                  onToggle={(on) => toggle(m, on)}
                  onDragStart={() => setDragId(m.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropAt(null)
                  }}
                  onDragOverRow={(before) => setDropAt(before ? index : index + 1)}
                  onDrop={() => {
                    if (dragId && dropAt !== null) {
                      const from = inv.profile.order.indexOf(dragId)
                      void moveTo(dragId, dropAt > from ? dropAt - 1 : dropAt)
                    }
                    setDragId(null)
                    setDropAt(null)
                  }}
                />
              )
            })}
            {visible.length === 0 && <div className="rows__none micro">{t('inv.list.noMatch')}</div>}
          </div>
        )}
      </section>

      <aside className="inv__detail">
        {bulk.length ? (
          <BulkDetail mods={bulk} onClear={() => setMulti(new Set())} onSelectVisible={() => setMulti(new Set(visible.map((m) => m.id)))} />
        ) : sel ? (
          <ModDetail
            key={sel.id}
            mod={sel}
            on={!!inv.profile.enabled[sel.id]}
            index={inv.profile.order.indexOf(sel.id)}
            onToggle={(on) => toggle(sel, on)}
            onRemoved={(name) => toast({ tone: 'ok', title: t('inv.list.removed'), body: name })}
          />
        ) : (
          <ClinicStatus />
        )}
      </aside>
    </div>
  )
}

function ModRow(props: {
  mod: ModRecord
  index: number
  on: boolean
  selected: boolean
  wins: number
  loses: number
  missing: string[]
  needs: MissingNexus[]
  update?: UpdateInfo
  dropBefore: boolean
  onSelect: (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void
  onToggle: (on: boolean) => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOverRow: (before: boolean) => void
  onDrop: () => void
}) {
  const g = useGlitch<HTMLDivElement>()
  const m = props.mod
  return (
    <div
      ref={g.ref}
      className={`row${props.on ? ' row--on' : ''}${props.selected ? ' row--sel' : ''}${props.dropBefore ? ' row--drop' : ''}`}
      onClick={(e) => props.onSelect(e)}
      onMouseDown={(e) => {
        // Umschalt+Klick soll nicht nebenbei Text markieren
        if (e.shiftKey) e.preventDefault()
      }}
      onMouseEnter={() => {
        play('hover')
        g.trigger()
      }}
      onAnimationEnd={g.onAnimationEnd}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MOD_DRAG, m.id)
        e.dataTransfer.effectAllowed = 'move'
        props.onDragStart()
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(MOD_DRAG)) return
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        props.onDragOverRow(e.clientY < r.top + r.height / 2)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(MOD_DRAG)) return
        e.preventDefault()
        props.onDrop()
      }}
    >
      <span className="row__grip" title={t('inv.row.drag')}>
        ⋮⋮
      </span>
      <span className="row__prio">{String(props.index + 1).padStart(2, '0')}</span>
      <Switch on={props.on} onChange={props.onToggle} title={props.on ? t('inv.row.disable') : t('inv.row.enable')} />
      <div className="row__main">
        <div className="row__name">
          {m.name}
          <span className="row__ver">V {m.version}</span>
        </div>
        <div className="row__chips">
          <TypeChips types={m.types} />
          {props.update?.hasUpdate && (
            <Chip tone="warn">{props.update.latestFileId ? `UPDATE ${props.update.latest}` : t('net.up.pickFile')}</Chip>
          )}
          {props.missing.length > 0 && <Chip tone="warn">{t('inv.row.requires', props.missing.join(', '))}</Chip>}
          {props.needs.length > 0 && (
            <Chip tone="warn" title={`${t('inv.row.needsHint')}: ${props.needs.map((n) => n.name).join(', ')}`}>
              {props.needs[0].off
                ? t('inv.row.needsOff', props.needs[0].name.toUpperCase(), props.needs.length - 1)
                : t('inv.row.needs', props.needs[0].name.toUpperCase(), props.needs.length - 1)}
            </Chip>
          )}
          {props.loses > 0 && (
            <Chip tone="alert" title={t('inv.row.overwrittenHint')}>
              {t('inv.row.overwritten', props.loses)}
            </Chip>
          )}
          {props.wins > 0 && (
            <Chip tone="accent" title={t('inv.row.winsHint')}>
              {t('inv.row.wins', props.wins)}
            </Chip>
          )}
        </div>
      </div>
      <span className="row__meta micro">{m.files.length} FILES</span>
    </div>
  )
}

function ModDetail(props: { mod: ModRecord; on: boolean; index: number; onToggle: (on: boolean) => void; onRemoved: (name: string) => void }) {
  const { inv, setInv, act, nexus, toast } = useCore()
  const m = props.mod
  const update = inv.updates[m.id]
  const fetchUpdate = async () => {
    const item = await act(() => window.rd.downloadUpdate(m.id))
    if (item) toast({ tone: 'info', title: 'DOWNLOAD', body: withVersion(item.name, item.version) })
  }
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(m.name)
  const [armed, setArmed] = useState(false)
  const reqs = useRequirements(m.source.nexusModId ?? null)
  const missingReqs = (reqs.list ?? []).filter((r) => r.state === 'missing' && !r.optional)
  const [fetching, setFetching] = useState(false)
  const getMissing = async () => {
    setFetching(true)
    await getRequirements({ act, toast }, missingReqs, m.name)
    setFetching(false)
  }
  // Endorsement (nur mit Key und Nexus-ID); Liste kommt gecacht aus dem Main-Prozess
  const nexusId = m.source.nexusModId
  const [endorsed, setEndorsed] = useState<boolean | null>(null)
  useEffect(() => {
    if (!nexus.hasKey || nexusId === undefined) return
    let live = true
    window.rd
      .nexusEndorsed()
      .then((ids) => live && setEndorsed(ids.includes(nexusId)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [nexus.hasKey, nexusId])
  const endorse = async () => {
    if (nexusId === undefined) return
    const on = !endorsed
    const ids = await act(() => window.rd.nexusEndorse(nexusId, m.version, on))
    if (!ids) return
    setEndorsed(ids.includes(nexusId))
    if (on) toast({ tone: 'ok', title: 'NEXUS', body: t('inv.detail.endorsedToast', m.name) })
  }

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])

  const total = m.files.reduce((s, f) => s + f.size, 0)
  const conflicts = inv.conflicts.filter((c) => c.winner === m.id || c.losers.includes(m.id))
  const nameOf = (id: string) => inv.mods.find((x) => x.id === id)?.name ?? id

  const remove = async () => {
    if (!armed) {
      setArmed(true)
      return
    }
    const next = await act(() => window.rd.removeMod(m.id))
    if (next) {
      setInv(next)
      props.onRemoved(m.name)
    }
  }

  const saveName = async () => {
    setRenaming(false)
    if (name.trim() && name !== m.name) {
      const next = await act(() => window.rd.renameMod(m.id, name))
      if (next) setInv(next)
    }
  }

  return (
    <Panel className="detail" tone="deep" cut={18}>
      <div className="detail__head">
        <Micro accent>IMPLANT // {m.id}</Micro>
        {renaming ? (
          <input
            className="input detail__rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
        ) : (
          <div className="detail__name" onDoubleClick={() => setRenaming(true)} title={t('inv.detail.renameHint')}>
            {m.name}
          </div>
        )}
        <div className="detail__chips">
          <Chip tone={props.on ? 'ok' : undefined}>{props.on ? 'ACTIVE' : 'INACTIVE'}</Chip>
          <Chip>V {m.version}</Chip>
          <Chip>PRIO {String(props.index + 1).padStart(2, '0')}</Chip>
          {update?.hasUpdate && <Chip tone="warn">{update.latestFileId ? `UPDATE ${update.latest}` : t('net.up.pickFile')}</Chip>}
        </div>
        {m.nexus && (
          <div className="nx-card">
            {m.nexus.picture ? <img src={m.nexus.picture} alt="" /> : <div className="nx-card__noimg micro">NEXUS</div>}
            <div>
              <Micro accent>NEXUS #{m.source.nexusModId}</Micro>
              {m.nexus.author && <div className="label">by {m.nexus.author}</div>}
              {m.nexus.summary && <div className="nx-card__summary">{decodeEntities(m.nexus.summary)}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="detail__body">
        <dl className="kv">
          <dt>{t('inv.mod.type')}</dt>
          <dd>
            <TypeChips types={m.types} />
          </dd>
          <dt>{t('inv.detail.source')}</dt>
          <dd className="mono">{m.source.archive}</dd>
          {m.source.nexusModId !== undefined && (
            <>
              <dt>Nexus</dt>
              <dd>Mod #{m.source.nexusModId}</dd>
            </>
          )}
          <dt>{t('inv.detail.installed')}</dt>
          <dd>{fmtTime(m.installedAt)}</dd>
          {m.origin && (
            <>
              <dt>{t('inv.detail.originLabel')}</dt>
              <dd>
                {m.origin.kind === 'collection'
                  ? t('inv.detail.origin.collection', m.origin.title)
                  : m.origin.kind === 'shard'
                    ? t('inv.detail.origin.shard', m.origin.title)
                    : t('inv.detail.origin.requirement', m.origin.title)}
              </dd>
            </>
          )}
          {update?.hasUpdate && !update.latestFileId && (
            <>
              <dt>Update</dt>
              <dd className="special">{t('inv.detail.updateOnNexus')}</dd>
            </>
          )}
          <dt>{t('inv.mod.files')}</dt>
          <dd>
            {m.files.length} · {fmtBytes(total)}
            {m.docs.length ? ` · ${t('inv.mod.docs', m.docs.length)}` : ''}
          </dd>
          <dt>{t('inv.detail.rule')}</dt>
          <dd className="dim">{m.rule}</dd>
          <dt>{t('inv.mod.provides')}</dt>
          <dd>{m.provides.length ? m.provides.map((f) => <Chip key={f} tone="accent">{frameworkById(f).short}</Chip>) : <span className="dim">—</span>}</dd>
          <dt>{t('inv.mod.requires')}</dt>
          <dd>
            {m.requires.length ? (
              m.requires.map((f) => (
                <Chip key={f} tone={inv.installedFrameworks.includes(f) ? 'ok' : 'warn'} title={frameworkById(f).name}>
                  {frameworkById(f).short} {inv.installedFrameworks.includes(f) ? '✓' : '✗'}
                </Chip>
              ))
            ) : (
              <span className="dim">{t('inv.mod.nothing')}</span>
            )}
          </dd>
          {(m.recommends?.length ?? 0) > 0 && (
            <>
              <dt>{t('inv.mod.recommends')}</dt>
              <dd>
                {m.recommends!.map((f) => (
                  <Chip key={f} tone={inv.installedFrameworks.includes(f) ? 'ok' : undefined} title={t('inv.mod.optionalHint')}>
                    {frameworkById(f).short} {inv.installedFrameworks.includes(f) ? '✓' : '○'}
                  </Chip>
                ))}
              </dd>
            </>
          )}
          {conflicts.length > 0 && (
            <>
              <dt>{t('inv.detail.conflicts')}</dt>
              <dd>
                {conflicts.slice(0, 6).map((c) => (
                  <div key={c.dst} className="conflict-line">
                    <span className={c.winner === m.id ? 'accent' : 'alert'}>{c.winner === m.id ? t('inv.detail.wins') : t('inv.detail.loses')}</span>{' '}
                    <span className="mono">{c.dst.split('/').pop()}</span>{' '}
                    <span className="dim">
                      {c.winner === m.id ? t('inv.detail.against', c.losers.map(nameOf).join(', ')) : t('inv.detail.lostTo', nameOf(c.winner))}
                    </span>
                  </div>
                ))}
                {conflicts.length > 6 && <div className="dim">{t('inv.detail.moreConflicts', conflicts.length - 6)}</div>}
              </dd>
            </>
          )}
        </dl>

        {m.source.nexusModId !== undefined && (
          <>
            <SectionHeader
              index={2}
              title={t('inv.req.title')}
              status={reqs.list ? `${reqs.list.filter((r) => r.state === 'ok').length}/${reqs.list.length} OK` : undefined}
            />
            <ReqStatus loading={reqs.loading} error={reqs.error} />
            {reqs.list && <ReqList list={reqs.list} />}
            <div className="config__buttons req__btns">
              {missingReqs.length > 0 && (
                <Btn size="small" variant="primary" onClick={getMissing} disabled={fetching}>
                  {fetching ? t('net.btn.checking') : t('inv.req.getMissing', missingReqs.length)}
                </Btn>
              )}
              <Btn size="small" onClick={reqs.reload} disabled={reqs.loading}>
                {t('inv.req.refresh')}
              </Btn>
            </div>
          </>
        )}

        <SectionHeader index={3} title={t('inv.mod.files')} status={`${m.files.length}`} />
        <ul className="filelist detail__files">
          {m.files.slice(0, 200).map((f) => (
            <li key={f.dst} title={`${f.dst} · ${fmtBytes(f.size)}`}>
              {f.dst}
            </li>
          ))}
          {m.files.length > 200 && <li className="dim">{t('inv.mod.more', m.files.length - 200)}</li>}
        </ul>
        {m.skipped.length > 0 && (
          <>
            <SectionHeader index={4} title={t('inv.detail.skipped')} status={`${m.skipped.length}`} />
            <ul className="filelist filelist--short dim">
              {m.skipped.slice(0, 12).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="detail__foot">
        <Switch on={props.on} onChange={props.onToggle} />
        <span className="detail__spacer" />
        {update?.hasUpdate && !!update.latestFileId && nexus.user?.premium && (
          <Btn size="small" variant="primary" onClick={fetchUpdate}>
            {t('inv.detail.getUpdate')}
          </Btn>
        )}
        {nexusId !== undefined && endorsed !== null && (
          <Btn
            size="small"
            variant={endorsed ? undefined : 'primary'}
            onClick={endorse}
            title={endorsed ? t('inv.detail.unendorseHint') : t('inv.detail.endorseHint')}
          >
            {endorsed ? t('inv.detail.endorsed') : t('inv.detail.endorse')}
          </Btn>
        )}
        {m.source.nexusModId !== undefined && (
          <Btn size="small" onClick={() => window.rd.openNexus(m.source.nexusModId ?? null)}>
            Nexus
          </Btn>
        )}
        <Btn size="small" onClick={() => window.rd.openFolder('mod', m.id)}>
          {t('inv.detail.folder')}
        </Btn>
        <Btn size="small" onClick={() => setRenaming(true)}>
          {t('inv.detail.rename')}
        </Btn>
        <Btn size="small" variant="danger" onClick={remove} sfx={armed ? 'press' : 'menu_open'}>
          {armed ? t('inv.detail.removeSure') : t('inv.detail.remove')}
        </Btn>
      </div>
    </Panel>
  )
}

/** Rechte Spalte bei Mehrfachauswahl: alle auf einmal an, aus oder entfernen (ein Einspielen statt vieler). */
function BulkDetail(props: { mods: ModRecord[]; onClear: () => void; onSelectVisible: () => void }) {
  const { inv, setInv, act, toast } = useCore()
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])
  const ids = props.mods.map((m) => m.id)
  const on = props.mods.filter((m) => inv.profile.enabled[m.id]).length
  const files = props.mods.reduce((n, m) => n + m.files.length, 0)
  const bytes = props.mods.reduce((n, m) => n + m.files.reduce((s, f) => s + f.size, 0), 0)

  const set = async (enable: boolean) => {
    const next = await act(() => window.rd.setEnabledMany(ids, enable))
    if (next) setInv(next)
  }
  const remove = async () => {
    if (!armed) return setArmed(true)
    const next = await act(() => window.rd.removeMany(ids))
    if (!next) return
    setInv(next)
    props.onClear()
    toast({ tone: 'ok', title: t('inv.list.removed'), body: t('inv.bulk.removed', ids.length) })
  }

  return (
    <Panel className="detail" tone="deep" cut={18}>
      <div className="detail__head">
        <Micro accent>MULTI-SELECT</Micro>
        <div className="detail__name">{t('inv.bulk.title', props.mods.length)}</div>
        <div className="detail__chips">
          <Chip tone={on ? 'ok' : undefined}>
            {on}/{props.mods.length} ACTIVE
          </Chip>
          <Chip>{t('inv.bulk.size', files, fmtBytes(bytes))}</Chip>
        </div>
        <p className="dim bulk__hint">{t('inv.bulk.hint')}</p>
      </div>
      <div className="detail__body">
        <ul className="filelist bulk__list">
          {props.mods.map((m) => (
            <li key={m.id} className={inv.profile.enabled[m.id] ? '' : 'dim'}>
              {m.name} <span className="dim">V {m.version}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="detail__foot detail__foot--wrap">
        <Btn size="small" variant="primary" onClick={() => set(true)} disabled={on === props.mods.length}>
          {t('inv.bulk.enable')}
        </Btn>
        <Btn size="small" onClick={() => set(false)} disabled={on === 0}>
          {t('inv.bulk.disable')}
        </Btn>
        <Btn size="small" variant="danger" onClick={remove} sfx={armed ? 'press' : 'menu_open'}>
          {armed ? t('inv.bulk.removeSure', props.mods.length) : t('inv.bulk.remove')}
        </Btn>
        <span className="detail__break" />
        <Btn size="small" onClick={props.onSelectVisible}>
          {t('inv.bulk.allVisible')}
        </Btn>
        <Btn size="small" onClick={props.onClear} sfx="menu_close">
          {t('inv.bulk.clear')}
        </Btn>
      </div>
    </Panel>
  )
}

/** Rechte Spalte ohne Auswahl: Zustand von Spiel, Staging und Frameworks. */
function ClinicStatus() {
  const { game, app, inv, go } = useCore()
  return (
    <Panel className="detail" tone="deep" cut={18}>
      <div className="detail__head">
        <Micro accent>CLINIC STATUS</Micro>
        <div className="detail__name">{game.found ? 'System ready' : 'Game missing'}</div>
        <div className="detail__chips">
          <Chip tone={game.found ? 'ok' : 'alert'}>{game.found ? 'LINKED' : 'NO GAME'}</Chip>
          <Chip tone={inv.deploy.snapshot ? 'ok' : undefined}>{inv.deploy.snapshot ? 'SNAPSHOT' : 'NO SNAPSHOT'}</Chip>
        </div>
      </div>
      <div className="detail__body">
        <dl className="kv">
          <dt>{t('inv.clinic.game')}</dt>
          <dd>{game.found ? `Patch ${game.patch} · Build ${game.build}` : game.error}</dd>
          <dt>DLC</dt>
          <dd>{game.phantomLiberty ? 'Phantom Liberty' : '—'}</dd>
          <dt>REDmod</dt>
          <dd className={game.redmodTool ? '' : 'dim'}>{game.redmodTool ? t('inv.clinic.redmodYes') : t('inv.clinic.redmodNo')}</dd>
          <dt>Staging</dt>
          <dd className="mono">{app.dataRoot}</dd>
          <dt>{t('inv.clinic.mode')}</dt>
          <dd>{app.sameVolume ? t('inv.clinic.hardlinks') : t('inv.clinic.copies')}</dd>
          <dt>Snapshot</dt>
          <dd className={inv.deploy.snapshot ? '' : 'dim'}>{inv.deploy.snapshot ? t('inv.clinic.snapshotYes') : t('inv.clinic.snapshotNo')}</dd>
        </dl>
        <SectionHeader index={2} title="Frameworks" status={`${inv.installedFrameworks.length} ONLINE`} />
        <div className="chips">
          {inv.installedFrameworks.length ? (
            inv.installedFrameworks.map((f) => (
              <Chip key={f} tone="ok">
                {frameworkById(f).short}
              </Chip>
            ))
          ) : (
            <span className="dim">{t('inv.clinic.noFrameworks')}</span>
          )}
        </div>
      </div>
      <div className="detail__foot">
        <span className="detail__spacer" />
        <Btn size="small" onClick={() => go('cyberware')}>
          Cyberware
        </Btn>
      </div>
    </Panel>
  )
}

function EmptyState() {
  const { startImport } = useCore()
  return (
    <div className="empty" onClick={() => void window.rd.pickFiles().then(startImport)}>
      <Panel className="empty__panel" cut={26}>
        <div className="empty__inner">
          <div className="empty__glyph">+</div>
          <div className="title">No implants installed</div>
          <p className="dim">{t('inv.empty.hint')}</p>
          <div className="chips">
            {['ZIP', '7Z', 'RAR', '.ARCHIVE', 'CET', 'REDSCRIPT', 'RED4EXT', 'TWEAKXL', 'REDMOD'].map((label) => (
              <Chip key={label}>{label}</Chip>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  )
}

/** Nexus liefert Kurzbeschreibungen mit HTML-Entities ("&#39;", "&amp;"); als reinen Text anzeigen. */
function decodeEntities(text: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}
