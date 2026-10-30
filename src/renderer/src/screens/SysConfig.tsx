import { useEffect, useState } from 'react'
import { t, type LangSetting } from '@shared/i18n'
import type { DownloadsUsage, ThemeName, VerifyReport } from '@shared/types'
import { play } from '../sfx'
import { fmtBytes, useCore } from '../state'
import { Btn, Chip, Micro, Panel, SectionHeader, Switch } from '../ui/kit'

const THEMES: ThemeName[] = ['RED', 'AMBER', 'ACID', 'VIOLET', 'ICE']
// Sprachnamen immer in der eigenen Sprache, damit man zurückfindet
const LANGS: [LangSetting, string][] = [
  ['auto', 'AUTO'],
  ['de', 'DEUTSCH'],
  ['en', 'ENGLISH'],
]

/** Schnell-Installieren und der Downloads-Ordner (Archive, die zu keinem Mod mehr gehören). */
function InstallBox() {
  const { settings, saveSettings, act, toast, inv } = useCore()
  const [usage, setUsage] = useState<DownloadsUsage | null>(null)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    void window.rd.downloadsUsage().then(setUsage)
  }, [inv])
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])
  const clean = async () => {
    if (!armed) return setArmed(true)
    setArmed(false)
    const freed = usage?.unusedBytes ?? 0
    const next = await act(() => window.rd.cleanDownloads())
    if (!next) return
    setUsage(next)
    toast({ tone: 'ok', title: t('config.install.cleanTitle'), body: t('config.install.cleaned', fmtBytes(freed)) })
  }
  return (
    <>
      <SectionHeader index={4} title={t('config.install.title')} status={settings.quickInstall ? 'QUICK' : 'DIALOG'} />
      <Panel cut={14} className="config__box">
        <div className="config__row">
          <span className="label">{t('config.install.quick')}</span>
          <Switch on={settings.quickInstall} onChange={(on) => void saveSettings({ quickInstall: on })} />
        </div>
        <p className="dim config__hint">{t('config.install.quickHint')}</p>
        <div className="config__row">
          <span className="label">{t('config.install.archives')}</span>
          {usage ? (
            <>
              <Micro>{t('config.install.usage', usage.files, fmtBytes(usage.bytes))}</Micro>
              {usage.unused > 0 && <Micro className="special">{t('config.install.unused', usage.unused, fmtBytes(usage.unusedBytes))}</Micro>}
            </>
          ) : (
            <Micro>…</Micro>
          )}
        </div>
        <div className="config__buttons">
          <Btn size="small" variant="danger" onClick={clean} disabled={!usage?.unused} title={t('config.install.cleanHint')} sfx={armed ? 'press' : 'menu_open'}>
            {armed ? t('config.install.cleanSure', fmtBytes(usage?.unusedBytes ?? 0)) : t('config.install.clean')}
          </Btn>
          <Btn size="small" onClick={() => window.rd.openFolder('downloads')}>
            {t('config.install.openDownloads')}
          </Btn>
        </div>
      </Panel>
    </>
  )
}

export function SysConfig() {
  const { settings, saveSettings, app, game, act, replayBoot, reloadGame, toast } = useCore()
  const [verify, setVerify] = useState<VerifyReport | null>(null)
  const steamOnly = game.store === 'gog' || game.store === 'epic'

  const runVerify = async () => {
    const r = await act(() => window.rd.verify())
    if (r) setVerify(r)
  }

  const changeRoot = async (pick: boolean) => {
    const r = await act(() => (pick ? window.rd.pickGameRoot() : window.rd.autoGameRoot()))
    if (!r) return
    play('enter')
    if (r.restart) {
      toast({ tone: 'info', title: t('config.root.restartTitle'), body: t('config.root.restartBody') })
      return
    }
    await reloadGame()
    setVerify(null)
    toast({ tone: 'ok', title: t('config.root.toastTitle'), body: r.game.root })
  }

  return (
    <div className="page config">
      <div className="config__col">
        <SectionHeader index={1} title="Look" status={settings.theme} active />
        <Panel cut={14} className="config__box">
          <div className="config__row">
            <span className="label">{t('config.look.theme')}</span>
            <div className="seg">
              {THEMES.map((theme) => (
                <button
                  key={theme}
                  className={settings.theme === theme ? 'on' : ''}
                  onMouseEnter={() => play('hover')}
                  onClick={() => {
                    play('move')
                    void saveSettings({ theme })
                  }}
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>
          <div className="config__row">
            <span className="label">{t('common.lang.label')}</span>
            <div className="seg">
              {LANGS.map(([id, label]) => (
                <button
                  key={id}
                  className={settings.language === id ? 'on' : ''}
                  onMouseEnter={() => play('hover')}
                  onClick={async () => {
                    play('move')
                    await saveSettings({ language: id })
                    await reloadGame() // Meldungen aus dem Main-Prozess (z. B. Spielsuche) neu holen
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {settings.language === 'auto' && <Micro>{t('common.lang.hint', app.systemLang.toUpperCase())}</Micro>}
          </div>
          <div className="config__row">
            <span className="label">Scanlines</span>
            <input
              className="range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.scanlines}
              onChange={(e) => void saveSettings({ scanlines: Number(e.target.value) })}
            />
            <Micro>{Math.round(settings.scanlines * 100)}%</Micro>
          </div>
        </Panel>

        <SectionHeader index={2} title="Audio" status={settings.sound ? 'ON' : 'OFF'} />
        <Panel cut={14} className="config__box">
          <div className="config__row">
            <span className="label">{t('config.audio.sounds')}</span>
            <Switch on={settings.sound} onChange={(on) => void saveSettings({ sound: on })} />
          </div>
          <div className="config__row">
            <span className="label">{t('config.audio.volume')}</span>
            <input
              className="range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => void saveSettings({ volume: Number(e.target.value) })}
              onMouseUp={() => play('press')}
            />
            <Micro>{Math.round(settings.volume * 100)}%</Micro>
          </div>
        </Panel>

        <SectionHeader index={3} title="Launch" status={settings.launchMode.toUpperCase()} />
        <Panel cut={14} className="config__box">
          <div className="config__row">
            <span className="label">{t('config.launch.via')}</span>
            <div className="seg">
              <button className={settings.launchMode === 'direct' ? 'on' : ''} onClick={() => void saveSettings({ launchMode: 'direct' })}>
                {t('config.launch.direct')}
              </button>
              <button
                className={settings.launchMode === 'steam' && !steamOnly ? 'on' : ''}
                disabled={steamOnly}
                title={steamOnly ? t('config.launch.storeOnlyExe', game.store.toUpperCase()) : undefined}
                onClick={() => void saveSettings({ launchMode: 'steam' })}
              >
                STEAM
              </button>
            </div>
          </div>
          <div className="config__row">
            <span className="label">{t('config.launch.skipIntro')}</span>
            <Switch on={settings.skipStartScreen} onChange={(on) => void saveSettings({ skipStartScreen: on })} />
            <Micro>{settings.launchMode === 'steam' && !steamOnly ? t('config.launch.skipIntroSteam') : '-SKIPSTARTSCREEN'}</Micro>
          </div>
        </Panel>

        <InstallBox />
      </div>

      <div className="config__col">
        <SectionHeader index={5} title={t('config.paths.title')} status={app.sameVolume ? 'HARDLINK' : 'COPY'} />
        <Panel cut={14} className="config__box">
          <dl className="kv">
            <dt>{t('config.paths.game')}</dt>
            <dd className="mono">{game.found ? game.root : game.error}</dd>
            <dt>{t('config.paths.source')}</dt>
            <dd>{settings.gameRoot ? t('config.paths.manual') : t('config.paths.auto', game.store)}</dd>
            <dt>{t('config.paths.data')}</dt>
            <dd className="mono">{app.dataRoot}</dd>
            <dt>{t('config.paths.drive')}</dt>
            <dd>
              <Chip tone={app.sameVolume ? 'ok' : 'warn'}>{app.sameVolume ? t('config.paths.sameDrive') : t('config.paths.otherDrive')}</Chip>
            </dd>
          </dl>
          <div className="config__buttons">
            <Btn size="small" variant={game.found ? undefined : 'primary'} onClick={() => changeRoot(true)}>
              {t('config.paths.pickRoot')}
            </Btn>
            {settings.gameRoot && (
              <Btn size="small" onClick={() => changeRoot(false)}>
                {t('config.paths.autoRoot')}
              </Btn>
            )}
            <Btn size="small" onClick={() => window.rd.openFolder('game')} disabled={!game.found}>
              {t('config.paths.openGame')}
            </Btn>
            <Btn size="small" onClick={() => window.rd.openFolder('data')}>
              {t('config.paths.openData')}
            </Btn>
          </div>
        </Panel>

        <SectionHeader index={6} title={t('config.maint.title')} />
        <Panel cut={14} className="config__box">
          <div className="config__buttons">
            <Btn size="small" onClick={runVerify} disabled={!game.found}>
              {t('config.maint.verify')}
            </Btn>
            <Btn size="small" onClick={replayBoot}>
              {t('config.maint.replayBoot')}
            </Btn>
          </div>
          {verify && (
            <div className="verify">
              <div>
                <Chip tone={verify.missing.length + verify.replaced.length ? 'alert' : 'ok'}>{t('config.maint.linksOk', verify.ok)}</Chip>{' '}
                {verify.missing.length > 0 && <Chip tone="alert">{t('config.maint.missing', verify.missing.length)}</Chip>}{' '}
                {verify.replaced.length > 0 && <Chip tone="warn">{t('config.maint.replaced', verify.replaced.length)}</Chip>}{' '}
                <Chip tone={verify.unmanaged.length ? 'warn' : undefined}>{t('config.maint.unmanaged', verify.unmanaged.length)}</Chip>
              </div>
              {verify.unmanaged.length > 0 && (
                <>
                  <p className="dim">{t('config.maint.unmanagedHint')}</p>
                  <ul className="filelist filelist--short">
                    {verify.unmanaged.slice(0, 10).map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </>
              )}
              {verify.missing.length + verify.replaced.length > 0 && <p className="dim">{t('config.maint.autoRepair')}</p>}
            </div>
          )}
        </Panel>

        <SectionHeader index={7} title="About" />
        <Panel cut={14} className="config__box">
          <dl className="kv">
            <dt>Version</dt>
            <dd>
              RIPPERDOC {app.version} · Electron {app.electron}
            </dd>
            <dt>{t('config.about.note')}</dt>
            <dd className="dim">{t('config.about.disclaimer')}</dd>
          </dl>
        </Panel>
      </div>
    </div>
  )
}
