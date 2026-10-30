import { useEffect, useState } from 'react'
import { frameworkById } from '@shared/frameworks'
import { t } from '@shared/i18n'
import type { ImportPreview, UnknownChoice } from '@shared/types'
import { play } from '../sfx'
import { useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader } from '../ui/kit'
import { TypeChips } from './parts'
import { defaultPicks, getRequirements, ReqList, ReqStatus, useRequirements } from './Requirements'

const SHOW_FILES = 160
const NAME_SLOT = '\u0000'

/** "NEW IMPLANT DETECTED": Vorschau eines Imports, Varianten-Wahl, Umgang mit unbekannten Dateien. */
export function ImportDialog(props: { preview: ImportPreview; remaining: number; onReplace: (p: ImportPreview) => void; onClose: (token: string) => void }) {
  const { act, toast, inv, setInv, nexus } = useCore()
  const p = props.preview
  const [name, setName] = useState(p.name)
  const [unknown, setUnknown] = useState<UnknownChoice>('skip')
  const [replace, setReplace] = useState(p.replaceDefault)
  const [working, setWorking] = useState(false)
  const replaced = p.replaces ? inv.mods.find((m) => m.id === p.replaces) : null
  const reqs = useRequirements(p.nexusModId)
  // Vorauswahl einmal, sobald die Liste da ist; danach bestimmt der Nutzer
  const [picked, setPicked] = useState<Set<number> | null>(null)
  useEffect(() => {
    if (reqs.list && picked === null) setPicked(defaultPicks(reqs.list))
  }, [reqs.list, picked])
  const pick = (id: number, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s ?? [])
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const cancel = async () => {
    // Während des Installierens nicht abbrechen: der Main-Prozess räumt sonst den Temp-Ordner mitten im Staging weg
    if (working) return
    play('menu_close')
    await window.rd.cancelImport(p.token)
    props.onClose(p.token)
  }

  const choose = async (variant: string) => {
    setWorking(true)
    const next = await act(() => window.rd.chooseVariant(p.token, variant))
    setWorking(false)
    if (next) props.onReplace(next)
  }

  const install = async () => {
    setWorking(true)
    // replaces: der Mod, den dieser Dialog zum Ersetzen gezeigt hat; hat sich das inzwischen geändert, bricht der Main-Prozess ab
    const out = await act(() => window.rd.commitImport({ token: p.token, unknown, name, replace, replaces: p.replaces }))
    setWorking(false)
    if (!out) return
    if (!out.ok) {
      toast({ tone: 'alert', title: t('inv.import.failed'), body: out.error })
      return
    }
    const a = out.applied
    const n = a.linked + a.copied
    toast({
      tone: a.errors.length ? 'warn' : 'ok',
      title: `INSTALLED // ${out.mod.name}`,
      body: [
        t('inv.import.staged', out.mod.files.length),
        n ? t('inv.import.linked', n, !!a.copied) : null,
        a.backedUp ? t('inv.import.backedUp', a.backedUp) : null,
        a.errors.length ? t('inv.import.errors', a.errors.length, a.errors[0]) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })
    play('enter')
    setInv(await window.rd.inventory())
    props.onClose(p.token)
    // Angehakte Requirements jetzt holen (Premium: Download, sonst Nexus-Seiten)
    const want = (reqs.list ?? []).filter((r) => r.state === 'missing' && picked?.has(r.modId))
    await getRequirements({ act, toast }, want, out.mod.name)
  }

  const needsVariant = p.variants.length > 0
  const nothing = !needsVariant && p.mapped.length === 0 && (unknown === 'skip' || p.unknown.length === 0)
  // Der Name steht je nach Sprache vorn oder mitten im Satz; Platzhalter, damit er fett bleibt
  const [replaceBefore, replaceAfter = ''] = replaced ? t('inv.import.replace', NAME_SLOT, replaced.version).split(NAME_SLOT) : []

  return (
    <div className="modal-backdrop">
      <Panel className="modal" tone="accent" cut={22}>
        <div className="modal__head">
          <div>
            <Micro accent>
              NEW IMPLANT DETECTED{p.nexus ? ` // NEXUS #${p.nexus.modId}` : ''} {props.remaining > 0 ? `// ${props.remaining} MORE QUEUED` : ''}
            </Micro>
            <input className="input modal__name" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </div>
          <div className="modal__meta">
            {p.nexus?.picture && <img className="modal__pic" src={p.nexus.picture} alt="" />}
            <Chip>V {p.version}</Chip>
            {p.nexus?.author && <Micro>BY {p.nexus.author}</Micro>}
            {p.nexus?.category && <Micro>{p.nexus.category}</Micro>}
            <Micro>{p.archive}</Micro>
          </div>
        </div>

        <div className="modal__body">
          {needsVariant ? (
            <>
              <SectionHeader index={1} title={t('inv.import.variant')} status={t('inv.import.options', p.variants.length)} active />
              <p className="dim">{t('inv.import.variantHint')}</p>
              <div className="variants">
                {p.variants.map((v) => (
                  <Btn key={v} onClick={() => choose(v)} disabled={working} title={v === '' ? t('inv.import.rootVariantHint') : undefined}>
                    {v || t('inv.import.rootVariant')}
                  </Btn>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="import-grid">
                <div>
                  <SectionHeader index={1} title={t('inv.import.analysis')} status={p.rule.toUpperCase()} active />
                  <dl className="kv">
                    <dt>{t('inv.mod.type')}</dt>
                    <dd>
                      <TypeChips types={p.types} />
                    </dd>
                    <dt>{t('inv.mod.provides')}</dt>
                    <dd>{p.provides.length ? p.provides.map((f) => <Chip key={f} tone="accent">{frameworkById(f).short}</Chip>) : <span className="dim">—</span>}</dd>
                    <dt>{t('inv.mod.requires')}</dt>
                    <dd>
                      {p.requires.length ? (
                        p.requires.map((f) => (
                          <Chip key={f} tone={inv.installedFrameworks.includes(f) ? 'ok' : 'warn'}>
                            {frameworkById(f).short}
                          </Chip>
                        ))
                      ) : (
                        <span className="dim">{t('inv.mod.nothing')}</span>
                      )}
                    </dd>
                    {p.recommends.length > 0 && (
                      <>
                        <dt>{t('inv.mod.recommends')}</dt>
                        <dd>
                          {p.recommends.map((f) => (
                            <Chip key={f} tone={inv.installedFrameworks.includes(f) ? 'ok' : undefined} title={t('inv.mod.optionalHint')}>
                              {frameworkById(f).short}
                            </Chip>
                          ))}
                        </dd>
                      </>
                    )}
                    <dt>{t('inv.mod.files')}</dt>
                    <dd>
                      {t('inv.import.toGame', p.mapped.length)}
                      {p.docs.length ? ` · ${t('inv.mod.docs', p.docs.length)}` : ''}
                    </dd>
                  </dl>
                  {replaced && (
                    <label className="replace">
                      <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                      <span>
                        {replaceBefore}
                        <b>{replaced.name}</b>
                        {replaceAfter}
                        {!p.replaceDefault && <span className="dim"> · {t('inv.import.replaceAddon')}</span>}
                      </span>
                    </label>
                  )}
                </div>
                <div className="import-files">
                  <SectionHeader index={2} title={t('inv.import.targets')} status={`${p.mapped.length} FILES`} />
                  <ul className="filelist">
                    {p.mapped.slice(0, SHOW_FILES).map((m) => (
                      <li key={m.dst} title={m.src}>
                        {m.dst}
                      </li>
                    ))}
                    {p.mapped.length > SHOW_FILES && <li className="dim">{t('inv.mod.more', p.mapped.length - SHOW_FILES)}</li>}
                  </ul>
                </div>
              </div>

              {p.unknown.length > 0 && (
                <div className="import-warn">
                  <SectionHeader index={3} title={t('inv.import.unknown')} status={`${p.unknown.length} FILES`} />
                  <ul className="filelist filelist--short">
                    {p.unknown.slice(0, 12).map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                  <div className="seg">
                    <button className={unknown === 'skip' ? 'on' : ''} onClick={() => setUnknown('skip')}>
                      {t('inv.import.skip')}
                    </button>
                    <button className={unknown === 'root' ? 'on' : ''} onClick={() => setUnknown('root')}>
                      {t('inv.import.toRoot')}
                    </button>
                  </div>
                </div>
              )}
              {p.blocked.length > 0 && (
                <div className="import-warn">
                  <SectionHeader index={p.unknown.length ? 4 : 3} title={t('inv.import.blocked')} status={`${p.blocked.length} FILES`} />
                  <p className="alert">{t('inv.import.blockedHint')}</p>
                  <ul className="filelist filelist--short">
                    {p.blocked.slice(0, 8).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              {p.nexusModId !== null && (
                <div className="import-warn">
                  <SectionHeader
                    index={3 + (p.unknown.length ? 1 : 0) + (p.blocked.length ? 1 : 0)}
                    title={t('inv.req.title')}
                    status={reqs.list ? `${reqs.list.filter((r) => r.state === 'ok').length}/${reqs.list.length} OK` : undefined}
                  />
                  <ReqStatus loading={reqs.loading} error={reqs.error} />
                  {reqs.list && <ReqList list={reqs.list} picked={picked ?? undefined} onPick={pick} />}
                  {reqs.list?.some((r) => r.state === 'missing') && (
                    <p className="dim req__note">
                      {t('inv.req.alsoGet')} · {nexus.user?.premium ? t('inv.req.premiumNote') : t('inv.req.freeNote')}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal__foot">
          <Btn onClick={cancel} sfx="menu_close" disabled={working}>
            {t('common.cancel')}
          </Btn>
          {!needsVariant && (
            <Btn
              variant="primary"
              onClick={install}
              // Erst wenn die Requirements da sind, sonst gingen die Haken verloren
              disabled={working || nothing || reqs.loading}
              title={reqs.loading ? t('inv.req.loading') : undefined}
              sfx="press"
            >
              {replace && replaced ? t('inv.import.installUpdate') : t('inv.import.install')}
            </Btn>
          )}
        </div>
      </Panel>
    </div>
  )
}
