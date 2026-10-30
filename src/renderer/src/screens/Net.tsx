import { NEXUS_STATUS_PAGE, withVersion } from '@shared/brand'
import { useEffect, useState } from 'react'
import { hhmm, t, type TKey } from '@shared/i18n'
import type { DownloadItem } from '@shared/types'
import { play } from '../sfx'
import { fmtBytes, fmtTime, useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader } from '../ui/kit'

const countdown = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`)
const openStatusPage = () => window.open(NEXUS_STATUS_PAGE, '_blank')

/** NET: Nexus-Konto, nxm-Verknüpfung, Downloads und Updates. */
export function Net() {
  const { nexus, setNexus } = useCore()
  // Beim Öffnen den Nexus-Status auffrischen (Main fragt die Statusseite höchstens alle paar Minuten)
  useEffect(() => {
    void window.rd.nexusHealth().then(setNexus)
  }, [setNexus])
  return (
    <div className="page net">
      <div className="net__col">
        <Uplink />
        <NxmLink />
      </div>
      <div className="net__col">
        <Downloads />
        {nexus.hasKey && <Updates />}
      </div>
    </div>
  )
}

function Uplink() {
  const { nexus, setNexus, act, toast } = useCore()
  const [key, setKey] = useState('')
  const [armed, setArmed] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(t)
  }, [armed])

  const save = async () => {
    setWorking(true)
    const st = await act(() => window.rd.nexusSetKey(key))
    setWorking(false)
    if (!st) return
    setKey('')
    setNexus(st)
    play('enter')
    toast({ tone: 'ok', title: 'UPLINK ONLINE', body: t('net.uplink.signedIn', st.user?.name ?? '') })
  }

  const clear = async () => {
    if (!armed) return setArmed(true)
    const st = await act(() => window.rd.nexusClearKey())
    if (st) setNexus(st)
  }

  const u = nexus.user
  const online = !!u && nexus.verified && !nexus.outage
  const status = online
    ? 'ONLINE'
    : nexus.outage
      ? t('net.uplink.status.disrupted')
      : nexus.checking
        ? t('net.uplink.status.connecting')
        : u
          ? t('net.uplink.status.unverified')
          : nexus.hasKey
            ? t('common.error')
            : 'OFFLINE'
  return (
    <>
      <SectionHeader index={1} title="Uplink // Nexus Mods" status={status} active={online} />
      <Panel cut={18} tone={online ? 'accent' : nexus.error ? 'alert' : undefined} className="net__box">
        {u ? (
          <div className="uplink">
            <Micro accent>NETRUNNER ID</Micro>
            <div className="uplink__name">{u.name}</div>
            <div className="chips">
              <Chip tone={u.premium ? 'ok' : undefined}>{u.premium ? 'PREMIUM' : 'FREE'}</Chip>
              {u.supporter && <Chip tone="accent">SUPPORTER</Chip>}
              <Chip>{t('net.uplink.keyEncrypted')}</Chip>
              {!nexus.verified && (
                <Chip tone="warn" title={t('net.uplink.lastKnownHint')}>
                  {nexus.checking ? t('net.uplink.checkingChip') : t('net.uplink.lastKnown')}
                </Chip>
              )}
            </div>
            {nexus.rate && <Micro>{t('net.uplink.rate', nexus.rate.hourly, nexus.rate.daily)}</Micro>}
            <p className="dim">{u.premium ? t('net.uplink.premium') : t('net.uplink.free')}</p>
          </div>
        ) : (
          <div className="uplink">
            {nexus.error ? (
              <p className="alert">{nexus.error}</p>
            ) : nexus.hasKey ? (
              <p className="dim">{nexus.checking ? t('net.uplink.connecting') : t('net.uplink.notVerified')}</p>
            ) : (
              <p className="dim">{t('net.uplink.noAccount')}</p>
            )}
            <p className="dim">{t('net.uplink.keyHelp')}</p>
          </div>
        )}
        {nexus.outage && <OutageBox />}
        <div className="uplink__form">
          <input
            className="input"
            type="password"
            placeholder={nexus.hasKey ? t('net.uplink.newKey') : t('net.uplink.personalKey')}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && key && save()}
            spellCheck={false}
            autoComplete="off"
          />
          <Btn variant="primary" onClick={save} disabled={!key.trim() || working || !nexus.canEncrypt}>
            {working ? t('net.btn.checking') : t('net.btn.connect')}
          </Btn>
          {nexus.hasKey && (
            <Btn variant="danger" onClick={clear} sfx={armed ? 'press' : 'menu_open'}>
              {armed ? t('common.sure') : t('net.uplink.deleteKey')}
            </Btn>
          )}
        </div>
        {!nexus.canEncrypt && <p className="alert">{t('net.uplink.noEncryption')}</p>}
        <HealthLine />
      </Panel>
    </>
  )
}

/** Nexus antwortet nicht: was los ist, was trotzdem geht, wann der nächste Versuch kommt. */
function OutageBox() {
  const { nexus, setNexus, act } = useCore()
  const o = nexus.outage!
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const retry = async () => {
    const st = await act(() => window.rd.nexusReconnect())
    if (st) setNexus(st)
  }
  const left = o.retryAt ? Math.max(0, Math.round((o.retryAt - now) / 1000)) : null
  return (
    <div className="outage">
      <div className="outage__head">
        <Chip tone="warn">{t('net.outage.chip')}</Chip>
        <Micro>{t('net.outage.since', hhmm(o.since))}</Micro>
        {left !== null && <Micro className="special">{t('net.outage.nextTry', countdown(left).toUpperCase())}</Micro>}
      </div>
      <p>{o.message}</p>
      <p className="dim">{t('net.outage.explain')}</p>
      <div className="config__buttons">
        <Btn size="small" variant="primary" onClick={retry} disabled={nexus.checking}>
          {nexus.checking ? t('net.btn.checking') : t('net.outage.tryNow')}
        </Btn>
        <Btn size="small" onClick={openStatusPage}>
          {t('net.outage.statusPage')}
        </Btn>
      </div>
    </div>
  )
}

/** Was die öffentliche Statusseite von Nexus gerade meldet. */
function HealthLine() {
  const h = useCore().nexus.health
  if (!h) return null
  const ok = h.indicator === 'none'
  return (
    <div className={`health${ok ? '' : ' health--warn'}`}>
      <Micro className={ok ? 'ok' : 'special'}>
        NEXUS STATUS · {h.description} · {hhmm(h.checkedAt)}
      </Micro>
      {h.incident && (
        <span className="health__incident">
          {h.incident}
          {h.degraded.length > 0 && <span className="dim"> · {t('net.health.affects', h.degraded.join(', '))}</span>}
        </span>
      )}
      {!ok && !h.incident && h.degraded.length > 0 && (
        <span className="health__incident dim">{t('net.health.affectsAlone', h.degraded.join(', '))}</span>
      )}
    </div>
  )
}

function NxmLink() {
  const { nexus, setNexus, act } = useCore()
  const set = async (on: boolean) => {
    const st = await act(() => window.rd.nexusSetNxm(on))
    if (st) setNexus(st)
  }
  const status =
    nexus.nxm === 'ours' ? t('net.nxm.status.connected') : nexus.nxm === 'other' ? t('net.nxm.status.taken') : t('net.nxm.status.off')
  return (
    <>
      <SectionHeader index={2} title="Mod Manager Download" status={status} />
      <Panel cut={18} className="net__box">
        <div className="uplink">
          {nexus.nxm === 'ours' ? (
            <p>
              {t('net.nxm.ours.pre')}
              <b className="accent">{t('net.nxm.ours.button')}</b>
              {t('net.nxm.ours.post')}
            </p>
          ) : nexus.nxm === 'other' ? (
            <p>
              {t('net.nxm.other.pre')}
              <b className="special">{nexus.nxmOther}</b>
              {t('net.nxm.other.post')}
            </p>
          ) : (
            <p className="dim">{t('net.nxm.none')}</p>
          )}
          <div className="config__buttons">
            {nexus.nxm === 'ours' ? (
              <Btn size="small" onClick={() => set(false)}>
                {t('net.nxm.disconnect')}
              </Btn>
            ) : (
              <Btn size="small" variant="primary" onClick={() => set(true)}>
                {nexus.nxm === 'other' ? t('net.nxm.takeOver') : t('net.btn.connect')}
              </Btn>
            )}
            <Btn size="small" onClick={() => window.rd.openNexus(null)}>
              {t('net.nxm.openNexus')}
            </Btn>
          </div>
        </div>
      </Panel>
    </>
  )
}

// Schlüssel statt fertiger Texte, damit der Sprachwechsel greift
const STATE_LABEL = {
  queued: 'net.dl.state.queued',
  preparing: 'net.dl.state.preparing',
  downloading: 'net.dl.state.downloading',
  done: 'net.dl.state.done',
  error: 'common.error',
  canceled: 'net.dl.state.canceled',
} as const satisfies Record<DownloadItem['state'], TKey>

const RUNNING = new Set<DownloadItem['state']>(['queued', 'preparing', 'downloading'])

function Downloads() {
  const { downloads, act } = useCore()
  const finished = downloads.some((d) => ['done', 'error', 'canceled'].includes(d.state))
  const queued = downloads.filter((d) => d.state === 'queued')
  const retry = (id: string) => act(() => window.rd.retryDownload(id))
  return (
    <>
      <SectionHeader index={3} title="Downloads" status={t('net.dl.active', downloads.filter((d) => RUNNING.has(d.state)).length)} />
      <Panel cut={18} className="net__box">
        {downloads.length === 0 ? (
          <p className="dim">{t('net.dl.empty')}</p>
        ) : (
          <div className="dl-list">
            {downloads.map((d) => (
              <div key={d.id} className={`dl dl--${d.state}`}>
                <div className="dl__head">
                  <span className="dl__name">{d.name}</span>
                  {d.version !== '?' && <Micro>V {d.version}</Micro>}
                  {d.origin && <Micro className="dl__origin">{d.origin.title}</Micro>}
                  <span className="dl__spacer" />
                  {d.auto && d.state !== 'done' && (
                    <Chip title={t('net.dl.autoHint')}>{t('net.dl.auto')}</Chip>
                  )}
                  <Chip tone={d.state === 'done' ? 'ok' : d.state === 'error' ? 'alert' : d.state === 'downloading' || d.state === 'preparing' ? 'accent' : undefined}>
                    {t(STATE_LABEL[d.state])}
                  </Chip>
                  {(d.state === 'error' || d.state === 'canceled') && (
                    <Btn
                      size="small"
                      variant="primary"
                      onClick={() => retry(d.id)}
                      title={d.state === 'error' && d.received > 0 ? t('net.dl.resumeHint') : undefined}
                    >
                      {t('net.dl.retry')}
                    </Btn>
                  )}
                  {RUNNING.has(d.state) && (
                    <Btn size="small" onClick={() => window.rd.cancelDownload(d.id)} title={t('common.cancel')}>
                      ✕
                    </Btn>
                  )}
                </div>
                <div className={`dl__bar${d.state === 'preparing' ? ' dl__bar--scan' : ''}`}>
                  <span style={{ width: `${d.total ? Math.min(100, (d.received / d.total) * 100) : d.state === 'done' ? 100 : 0}%` }} />
                </div>
                <div className="dl__meta">
                  {d.state === 'preparing' ? (
                    <Micro>{t('net.dl.fetching')}</Micro>
                  ) : (
                    <Micro>
                      {fmtBytes(d.received)} / {d.total ? fmtBytes(d.total) : '?'}
                    </Micro>
                  )}
                  {d.state === 'downloading' && d.speed > 0 && <Micro accent>{fmtBytes(d.speed)}/S</Micro>}
                  {d.resumed && d.state !== 'error' && <Micro className="special">{t('net.dl.resumed')}</Micro>}
                  {d.note && <span className="special dl__error">{d.note}</span>}
                  {d.error && <span className="alert dl__error">{d.error}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        {(finished || queued.length > 1) && (
          <div className="config__buttons">
            {finished && (
              <Btn size="small" onClick={() => window.rd.clearDownloads()}>
                {t('net.dl.hideFinished')}
              </Btn>
            )}
            {/* Eine Collection reiht Hunderte ein: alle wartenden auf einmal abbrechen */}
            {queued.length > 1 && (
              <Btn size="small" onClick={() => queued.forEach((d) => void window.rd.cancelDownload(d.id))}>
                {t('net.dl.cancelQueued', queued.length)}
              </Btn>
            )}
          </div>
        )}
      </Panel>
    </>
  )
}

function Updates() {
  const { inv, nexus, act, toast } = useCore()
  const [checking, setChecking] = useState(false)
  const withId = inv.mods.filter((m) => m.source.nexusModId !== undefined)
  const pending = Object.values(inv.updates).filter((u) => u.hasUpdate)

  const check = async () => {
    setChecking(true)
    const res = await act(() => window.rd.checkUpdates())
    setChecking(false)
    if (res) {
      const n = Object.values(res).filter((u) => u.hasUpdate).length
      toast({ tone: n ? 'warn' : 'ok', title: t('net.up.toastTitle'), body: n ? t('net.up.toastFound', n) : t('net.up.toastNone') })
    }
  }

  const fetchUpdate = async (recordId: string) => {
    const item = await act(() => window.rd.downloadUpdate(recordId))
    if (item) toast({ tone: 'info', title: 'DOWNLOAD', body: withVersion(item.name, item.version) })
  }

  return (
    <>
      <SectionHeader index={4} title="Updates" status={nexus.lastCheck ? t('net.up.checked', fmtTime(nexus.lastCheck)) : t('net.up.neverChecked')} />
      <Panel cut={18} className="net__box">
        {withId.length === 0 ? (
          <p className="dim">{t('net.up.empty')}</p>
        ) : (
          <div className="up-list">
            {withId.map((m) => {
              const u = inv.updates[m.id]
              return (
                <div key={m.id} className="up">
                  <span className="up__name">{m.name}</span>
                  <Micro>
                    V {m.version}
                    {u?.hasUpdate ? ` → ${u.latest}` : ''}
                  </Micro>
                  <span className="dl__spacer" />
                  {u?.error ? (
                    <Chip tone="alert" title={u.error}>
                      {t('common.error')}
                    </Chip>
                  ) : u?.hasUpdate ? (
                    <Chip tone="warn" title={u.latestFileId ? undefined : t('net.up.outdatedHint')}>
                      {u.latestFileId ? 'UPDATE' : t('net.up.pickFile')}
                    </Chip>
                  ) : u ? (
                    <Chip tone="ok">{t('net.up.current')}</Chip>
                  ) : (
                    <Chip>?</Chip>
                  )}
                  {u?.hasUpdate &&
                    (nexus.user?.premium && u.latestFileId ? (
                      <Btn size="small" variant="primary" onClick={() => fetchUpdate(m.id)}>
                        {t('net.up.download')}
                      </Btn>
                    ) : (
                      <Btn size="small" onClick={() => window.rd.openNexus(m.source.nexusModId ?? null)}>
                        Nexus
                      </Btn>
                    ))}
                </div>
              )
            })}
          </div>
        )}
        <div className="config__buttons">
          <Btn size="small" onClick={check} disabled={checking || withId.length === 0}>
            {checking ? t('net.btn.checking') : t('net.up.checkNow')}
          </Btn>
          {pending.length > 0 && <Micro className="special">{t('net.up.pending', pending.length)}</Micro>}
        </div>
      </Panel>
    </>
  )
}
