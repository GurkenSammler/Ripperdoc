import { useCallback, useEffect, useState } from 'react'
import { t } from '@shared/i18n'
import type { FetchRun, NexusRequirement } from '@shared/types'
import { cleanError, useCore, type Ctx } from '../state'
import { Chip, Micro } from '../ui/kit'

/** Requirements eines Nexus-Mods laut seiner Nexus-Seite; null-ID = keine Abfrage. */
export function useRequirements(nexusModId: number | null) {
  const { inv } = useCore()
  const [list, setList] = useState<NexusRequirement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    async (refresh = false) => {
      if (nexusModId === null) return
      setError(null)
      try {
        setList(await window.rd.requirements(nexusModId, refresh))
      } catch (err) {
        setError(cleanError(err))
      }
    },
    [nexusModId],
  )
  // Inventar ändert sich (z. B. Requirement gerade installiert): Zustand neu abgleichen, ohne Netz (Cache)
  useEffect(() => {
    void load()
  }, [load, inv])
  return { list, error, loading: nexusModId !== null && list === null && !error, reload: () => load(true) }
}

/** Standard-Auswahl: was fehlt und laut Notiz nicht optional ist. */
export const defaultPicks = (list: NexusRequirement[]): Set<number> =>
  new Set(list.filter((r) => r.state === 'missing' && !r.optional).map((r) => r.modId))

export function ReqList(props: { list: NexusRequirement[]; picked?: Set<number>; onPick?: (modId: number, on: boolean) => void }) {
  const { downloads, act, setInv } = useCore()
  if (!props.list.length) return <p className="dim req__none">{t('inv.req.none')}</p>
  // Läuft für ein Requirement schon ein Download? Dann zeigen statt erneut anbieten
  const loading = (modId: number) => downloads.find((d) => d.nexusModId === modId && ['queued', 'preparing', 'downloading'].includes(d.state))
  const enable = async (recordId: string) => {
    const next = await act(() => window.rd.setEnabled(recordId, true))
    if (next) setInv(next)
  }
  return (
    <ul className="reqs">
      {props.list.map((r) => (
        <li key={r.modId} className={`req req--${r.state}`}>
          {props.onPick &&
            (r.state === 'missing' ? (
              <input type="checkbox" checked={!!props.picked?.has(r.modId)} onChange={(e) => props.onPick!(r.modId, e.target.checked)} />
            ) : (
              <span className="req__nobox" />
            ))}
          <button className="req__name" title={`Nexus #${r.modId}`} onClick={() => window.rd.openNexus(r.modId)}>
            {r.name}
          </button>
          {r.optional && <Chip>{t('inv.req.optional')}</Chip>}
          {r.state === 'missing' && loading(r.modId) ? (
            <Chip tone="accent">{loading(r.modId)!.state === 'downloading' ? t('net.dl.state.downloading') : t('net.dl.state.queued')}</Chip>
          ) : (
            <Chip tone={r.state === 'ok' ? 'ok' : r.state === 'off' ? 'warn' : r.optional ? undefined : 'alert'}>
              {r.state === 'ok' ? t('inv.req.ok') : r.state === 'off' ? t('inv.req.off') : t('inv.req.missing')}
            </Chip>
          )}
          {r.state === 'off' && r.recordId && (
            <button className="req__enable" onClick={() => enable(r.recordId!)}>
              {t('inv.req.enable')}
            </button>
          )}
          {r.notes && <span className="req__notes dim">{r.notes}</span>}
        </li>
      ))}
    </ul>
  )
}

export function ReqStatus(props: { loading: boolean; error: string | null }) {
  if (props.loading) return <Micro>{t('inv.req.loading')}</Micro>
  if (props.error) return <p className="alert req__none">{t('inv.req.failed', props.error)}</p>
  return null
}

/** Ausgewählte Requirements holen und das Ergebnis melden. */
export async function getRequirements(ctx: Pick<Ctx, 'act' | 'toast'>, list: NexusRequirement[], parent: string): Promise<FetchRun | undefined> {
  if (!list.length) return undefined
  const run = await ctx.act(() => window.rd.fetchRequirements(list.map((r) => ({ modId: r.modId, name: r.name })), parent))
  if (!run) return undefined
  if (run.queued.length) ctx.toast({ tone: 'info', title: 'REQUIREMENTS', body: t('inv.req.toastQueued', run.queued.length) })
  if (run.opened) ctx.toast({ tone: 'info', title: 'NEXUS', body: t('inv.req.toastOpened', run.opened, run.left) })
  for (const f of run.failed.slice(0, 2)) ctx.toast({ tone: 'alert', title: 'REQUIREMENTS', body: t('inv.req.toastFailed', f.name, f.error) })
  return run
}
