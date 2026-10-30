import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppInfo,
  DownloadItem,
  GameInfo,
  GameRunState,
  ImportPreview,
  InventoryView,
  ModPlan,
  NexusStatus,
  Notice,
  PurgeReport,
  Settings,
} from '@shared/types'
import { BRAND } from '@shared/brand'
import { getLang, resolveLang, setLang, t } from '@shared/i18n'
import { configureSfx, loadSfx, play } from './sfx'
import { cleanError, CoreCtx, MOD_DRAG, SCREENS, type Ctx, type ScreenId, type Toast } from './state'
import { Background, Barcode, Btn, Chip, GlitchFilters, HeaderLine, Micro, Panel, Scanlines, useGlitch } from './ui/kit'
import { Boot } from './screens/Boot'
import { ImportDialog } from './screens/ImportDialog'
import { Inventory } from './screens/Inventory'
import { Cyberware } from './screens/Cyberware'
import { LoadOrder } from './screens/LoadOrder'
import { Journal } from './screens/Journal'
import { SysConfig } from './screens/SysConfig'
import { Net } from './screens/Net'
import { PurgeDialog } from './screens/PurgeDialog'
import { Shards } from './screens/Shards'

const isShardFile = (p: string): boolean => /\.rdshard$/i.test(p)

const query = new URLSearchParams(location.search)


function Tab(props: { index: number; label: string; active: boolean; onClick: () => void }) {
  const g = useGlitch<HTMLButtonElement>()
  return (
    <button
      ref={g.ref}
      className={`tab${props.active ? ' tab--on' : ''}`}
      onAnimationEnd={g.onAnimationEnd}
      onMouseEnter={() => {
        play('hover')
        if (!props.active) g.trigger()
      }}
      onClick={props.onClick}
    >
      <span className="tab__idx">{String(props.index).padStart(2, '0')}</span>
      <span className="tab__label">{props.label}</span>
    </button>
  )
}

const runLabel: Record<GameRunState['phase'], string> = {
  idle: 'GAME OFFLINE',
  starting: 'BOOTING GAME',
  running: 'GAME RUNNING',
  exited: 'GAME CLOSED',
}

export function App() {
  const [boot, setBoot] = useState(!query.has('noboot'))
  const [screen, setScreen] = useState<ScreenId>((query.get('screen') as ScreenId) || 'inventory')
  const [app, setApp] = useState<AppInfo | null>(null)
  const [game, setGame] = useState<GameInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [inv, setInv] = useState<InventoryView | null>(null)
  const [run, setRun] = useState<GameRunState>({ phase: 'idle', since: Date.now() })
  const [busy, setBusy] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [imports, setImports] = useState<ImportPreview[]>([])
  const [dropping, setDropping] = useState(false)
  const [purge, setPurge] = useState<'ask' | PurgeReport | null>(null)
  const [nexus, setNexus] = useState<NexusStatus | null>(null)
  const [downloads, setDownloads] = useState<DownloadItem[]>([])
  const [plan, setPlan] = useState<ModPlan | null>(null)
  const planRef = useRef<ModPlan | null>(null)
  planRef.current = plan
  const [startError, setStartError] = useState<string | null>(null)
  const nextToast = useRef(1)
  const toastRef = useRef<(t: Omit<Toast, 'id'>) => void>(() => undefined)

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = nextToast.current++
    if (t.tone === 'alert') play('error')
    setToasts((all) => [...all.slice(-4), { ...t, id }])
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === 'alert' ? 9000 : 5000)
  }, [])
  toastRef.current = toast

  const act = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (err) {
        toast({ tone: 'alert', title: t('common.error'), body: cleanError(err) })
        return undefined
      }
    },
    [toast],
  )

  const refresh = useCallback(async () => {
    const [g, i] = await Promise.all([window.rd.gameInfo(), window.rd.inventory()])
    setGame(g)
    setInv(i)
  }, [])

  const reloadGame = useCallback(async () => {
    const [a, s, g, i] = await Promise.all([window.rd.appInfo(), window.rd.getSettings(), window.rd.gameInfo(), window.rd.inventory()])
    setApp(a)
    setSettings(s)
    setGame(g)
    setInv(i)
  }, [])

  // Start: alles laden, Sounds dekodieren, Ereignisse abonnieren
  useEffect(() => {
    void (async () => {
      const [a, s, g, i, r, sounds, nx, dl] = await Promise.all([
        window.rd.appInfo(),
        window.rd.getSettings(),
        window.rd.gameInfo(),
        window.rd.inventory(),
        window.rd.gameState(),
        window.rd.sounds(),
        window.rd.nexusStatus(),
        window.rd.downloads(),
      ])
      // Ein kaputter Sound darf den Start nicht aufhalten
      await loadSfx(sounds).catch(() => undefined)
      configureSfx(s.sound, s.volume)
      setApp(a)
      setSettings(s)
      setGame(g)
      setInv(i)
      setRun(r)
      setNexus(nx)
      setDownloads(dl)
      // Imports, die vor dem Start der Oberfläche fertig wurden (App per nxm-Klick gestartet)
      const waiting = await window.rd.pendingImports()
      if (waiting.length) setImports((q) => [...q, ...waiting])
      // Collection per Knopf auf der Website, bevor das Fenster da war
      const plans = await window.rd.pendingPlans()
      if (plans.length) {
        setPlan(plans[plans.length - 1])
        setScreen('shards')
      }
    })().catch((err) => setStartError(cleanError(err)))
    const offs = [
      window.rd.on('busy', (p) => setBusy((p as string | null) ?? null)),
      window.rd.on('game-state', (p) => setRun(p as GameRunState)),
      window.rd.on('inventory', () => void window.rd.inventory().then(setInv)),
      window.rd.on('nexus', () => void window.rd.nexusStatus().then(setNexus)),
      window.rd.on('downloads', (p) => setDownloads(p as DownloadItem[])),
      window.rd.on('imports', (p) => {
        play('menu_open')
        setImports((q) => [...q, ...(p as ImportPreview[])])
      }),
      window.rd.on('notify', (p) => toastRef.current(p as Notice)),
      window.rd.on('plan', (p) => {
        play('menu_open')
        // Klick auf der Website (oder Doppelklick auf eine .rdshard): die neue Liste zeigen, die alte nennen
        const prev = planRef.current
        const next = p as ModPlan
        if (prev && prev.id !== next.id) toastRef.current({ tone: 'info', title: 'SHARDS', body: t('shards.plan.replaced', prev.title) })
        setPlan(next)
        setScreen('shards')
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Spielende melden (Schritt 6 hängt hier den Logscan an)
  useEffect(() => {
    if (run.phase === 'exited') toast({ tone: 'info', title: 'GAME CLOSED', body: t('shell.toast.sessionEnded') })
  }, [run.phase, toast])

  // Sprache vor dem Rendern setzen; der Rahmen hängt per key daran, ein Wechsel zeichnet alles neu
  const lang = settings && app ? resolveLang(settings.language, [app.systemLang]) : getLang()
  setLang(lang)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (!settings) return
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.setProperty('--scanlines', String(settings.scanlines))
    configureSfx(settings.sound, settings.volume)
  }, [settings])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.rd.setSettings(patch))
  }, [])

  const startImport = useCallback(
    async (all: string[]) => {
      // .rdshard-Dateien sind Listen, keine Mods: in SHARDS öffnen
      const shard = all.find(isShardFile)
      if (shard) {
        const p = await act(() => window.rd.readShardFile(shard))
        if (p) {
          play('menu_open')
          setPlan(p)
          setScreen('shards')
        }
      }
      const paths = all.filter((p) => !isShardFile(p))
      if (paths.length === 0) return
      const res = await act(() => window.rd.prepare(paths))
      if (!res) return
      for (const f of res.failures) toast({ tone: 'alert', title: t('shell.toast.importFailed'), body: `${f.input.split(/[\\/]/).pop()}: ${f.error}` })
      if (res.previews.length) {
        play('menu_open')
        setImports((q) => [...q, ...res.previews])
      }
    },
    [act, toast],
  )

  const go = useCallback((s: ScreenId) => {
    play('tab')
    setScreen(s)
  }, [])

  // Test-Hook --import=<datei>: nach dem Laden direkt den Import-Dialog öffnen
  const ready = !!(app && game && settings && inv && nexus)
  useEffect(() => {
    const p = query.get('import')
    if (ready && p) {
      query.delete('import')
      void startImport([p])
    }
  }, [ready, startImport])

  // Q / E wie im Spiel, Strg+O öffnet den Datei-Dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Nur Texteingaben sperren Q/E (nicht Checkboxen, die nach einem Klick den Fokus haben)
      const el = e.target as HTMLElement | null
      const typing = el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range'].includes((el as HTMLInputElement).type))
      if (typing || imports.length || purge) return
      if ((e.key === 'q' || e.key === 'Q' || e.key === 'e' || e.key === 'E') && (e.ctrlKey || e.altKey || e.metaKey)) return
      const idx = SCREENS.findIndex((s) => s.id === screen)
      if (e.key === 'q' || e.key === 'Q') go(SCREENS[(idx + SCREENS.length - 1) % SCREENS.length].id)
      else if (e.key === 'e' || e.key === 'E') go(SCREENS[(idx + 1) % SCREENS.length].id)
      else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void window.rd.pickFiles().then(startImport)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen, go, startImport, imports.length, purge])

  // Dateien aufs Fenster ziehen → Import
  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files') && !e.dataTransfer.types.includes(MOD_DRAG)
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth++
      setDropping(true)
    }
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDropping(false)
    }
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return
      e.preventDefault()
      depth = 0
      setDropping(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.rd.pathForFile(f)).filter(Boolean)
      void startImport(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [startImport])

  const ctx: Ctx | null = useMemo(
    () =>
      app && game && settings && inv && nexus
        ? {
            app,
            game,
            settings,
            inv,
            nexus,
            setNexus,
            downloads,
            run,
            busy,
            refresh,
            reloadGame,
            setInv,
            saveSettings,
            toast,
            act,
            startImport,
            go,
            plan,
            setPlan,
            replayBoot: () => setBoot(true),
          }
        : null,
    [app, game, settings, inv, nexus, downloads, run, busy, refresh, reloadGame, saveSettings, toast, act, startImport, go, plan],
  )

  const launch = async () => {
    if (!ctx) return
    play('open')
    const ok = await act(() => window.rd.launch().then(() => true))
    if (ok) toast({ tone: 'ok', title: 'LAUNCH', body: inv?.deploy.suspended ? t('shell.toast.launchVanilla') : t('shell.toast.launchMods') })
  }

  const redeploy = async () => {
    const r = await act(() => window.rd.redeploy())
    if (r) {
      toast({ tone: 'ok', title: 'RE-DEPLOY', body: t('shell.toast.redeployed', r.linked + r.copied) })
      setInv(await window.rd.inventory())
    }
  }

  if (!ctx) {
    return (
      <>
        <Background />
        {startError ? (
          <div className="loading micro alert">{t('shell.start.failed', startError)}</div>
        ) : (
          <div className="loading micro">INITIALIZING…</div>
        )}
      </>
    )
  }

  const activeCount = inv!.mods.filter((m) => inv!.profile.enabled[m.id]).length
  const activeDl = downloads.filter((d) => d.state === 'queued' || d.state === 'preparing' || d.state === 'downloading')
  const dlTotal = activeDl.reduce((n, d) => n + d.total, 0)
  const dlPercent = dlTotal ? Math.floor((activeDl.reduce((n, d) => n + d.received, 0) / dlTotal) * 100) : 0
  const Screen = { inventory: Inventory, cyberware: Cyberware, loadorder: LoadOrder, net: Net, shards: Shards, journal: Journal, config: SysConfig }[screen]

  return (
    <CoreCtx.Provider value={ctx}>
      <GlitchFilters />
      <Background />
      {boot ? (
        <Boot onDone={() => setBoot(false)} />
      ) : (
        <div className="shell" key={lang}>
          <header className="titlebar">
            <div className="brand">
              <span className="brand__mark">R</span>
              <span className="brand__name">{BRAND.name}</span>
              <Micro>MOD CLINIC // NIGHT CITY</Micro>
            </div>
            <div className="titlebar__info">
              {game!.found ? (
                <>
                  <Micro>CP2077 PATCH {game!.patch}</Micro>
                  <Micro>BUILD {game!.build}</Micro>
                  <Micro>{game!.phantomLiberty ? 'PHANTOM LIBERTY' : 'BASE GAME'}</Micro>
                  <Micro>{game!.store.toUpperCase()}</Micro>
                </>
              ) : (
                <Micro className="alert">GAME NOT FOUND</Micro>
              )}
            </div>
          </header>

          <nav className="nav">
            <div className="tabs">
              <span className="key">Q</span>
              {SCREENS.map((s, i) => (
                <Tab key={s.id} index={i + 1} label={s.label} active={s.id === screen} onClick={() => go(s.id)} />
              ))}
              <span className="key">E</span>
            </div>
            <div className="nav__right">
              {busy && (
                <span className="busy">
                  <span className="busy__bar" />
                  <Micro accent>{busy}</Micro>
                </span>
              )}
              {activeDl.length > 0 && (
                <button className="dl-chip" onClick={() => go('net')} title="Downloads">
                  <Chip tone="accent">
                    DL {activeDl.length} · {dlPercent}%
                  </Chip>
                </button>
              )}
              {nexus!.outage && (
                <button className="dl-chip" onClick={() => go('net')} title={nexus!.outage.message}>
                  <Chip tone="warn">{t('shell.nexus.outage')}</Chip>
                </button>
              )}
              <Chip tone={run.phase === 'running' ? 'ok' : run.phase === 'starting' ? 'warn' : undefined}>{runLabel[run.phase]}</Chip>
              <Btn variant="danger" onClick={() => setPurge('ask')} disabled={!game!.found || run.phase === 'running'} sfx="menu_open">
                Purge
              </Btn>
              <Btn variant="primary" size="big" onClick={launch} disabled={!game!.found || run.phase !== 'idle' && run.phase !== 'exited'} sfx="enter">
                Launch
              </Btn>
            </div>
          </nav>
          <HeaderLine />

          {inv!.deploy.suspended && (
            <div className="banner banner--vanilla">
              <Chip tone="warn">VANILLA MODE</Chip>
              <span>{t('shell.banner.vanilla')}</span>
              <Btn size="small" variant="primary" onClick={redeploy}>
                Re-Deploy
              </Btn>
            </div>
          )}
          {game!.updatedSinceLastRun && (
            <div className="banner banner--update">
              <Chip tone="alert">GAME UPDATED</Chip>
              <span>{t('shell.banner.updated', game!.previousBuild ?? '', game!.build)}</span>
              <Btn size="small" onClick={() => go('cyberware')}>
                {t('shell.banner.checkCyberware')}
              </Btn>
            </div>
          )}

          <main className="content" key={screen}>
            <Screen />
          </main>

          <footer className="footer">
            <Micro className="footer__data" style={{ textTransform: 'none' }}>
              DATA {app!.dataRoot}
            </Micro>
            <Micro className={app!.sameVolume ? '' : 'special'}>MODE {inv!.deploy.mode.toUpperCase()}</Micro>
            <Micro>DEPLOYED {inv!.deploy.deployed} FILES</Micro>
            <Micro>
              ACTIVE {activeCount}/{inv!.mods.length}
            </Micro>
            <Micro className={inv!.deploy.snapshot ? 'ok' : ''}>{inv!.deploy.snapshot ? 'VANILLA SNAPSHOT OK' : 'NO SNAPSHOT YET'}</Micro>
            <span className="footer__spacer" />
            <Micro>[DRAG] INSTALL · [CTRL+O] PICK FILES · [CTRL/SHIFT+CLICK] MULTI · [Q/E] TABS</Micro>
            <Barcode seed={app!.version.length * 31} />
            <Micro>
              V{app!.version} · E{app!.electron.split('.')[0]}
            </Micro>
          </footer>
        </div>
      )}

      {dropping && (
        <div className="dropzone-overlay">
          <Panel tone="accent" cut={22} className="dropzone-overlay__panel">
            <div className="title accent">Drop to install</div>
            <Micro accent>{t('shell.drop.formats')}</Micro>
          </Panel>
        </div>
      )}

      {imports.length > 0 && (
        <ImportDialog
          key={imports[0].token}
          preview={imports[0]}
          remaining={imports.length - 1}
          onReplace={(p) => setImports((q) => q.map((x) => (x.token === p.token ? p : x)))}
          onClose={(token) => setImports((q) => q.filter((x) => x.token !== token))}
        />
      )}

      {purge && <PurgeDialog state={purge} onState={setPurge} />}

      <div className="toasts">
        {toasts.map((t) => (
          <Panel key={t.id} className="toast" tone={t.tone === 'alert' ? 'alert' : t.tone === 'ok' ? 'accent' : undefined} cut={10}>
            <div className={`label ${t.tone === 'alert' ? 'alert' : t.tone === 'ok' ? 'accent' : t.tone === 'warn' ? 'special' : ''}`}>{t.title}</div>
            {t.body && <div className="toast__body">{t.body}</div>}
          </Panel>
        ))}
      </div>
      <Scanlines />
    </CoreCtx.Provider>
  )
}


