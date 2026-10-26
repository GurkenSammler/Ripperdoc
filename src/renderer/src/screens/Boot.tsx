import { useEffect, useState } from 'react'
import { BRAND } from '@shared/brand'
import { play } from '../sfx'
import { useCore } from '../state'
import { Barcode, Micro } from '../ui/kit'

type Line = { text: string; status: string; tone?: 'ok' | 'warn' | 'alert' }

/** Boot-Sequenz mit echten Daten. Klick oder Taste überspringt. */
export function Boot(props: { onDone: () => void }) {
  const { game, app, inv } = useCore()
  const [shown, setShown] = useState(0)
  const [leaving, setLeaving] = useState(false)

  const active = inv.mods.filter((m) => inv.profile.enabled[m.id]).length
  const lines: Line[] = [
    { text: `${BRAND.name} KERNEL V${app.version}`, status: 'LOADED', tone: 'ok' },
    { text: 'SCAN STEAM LIBRARY', status: game.found ? 'OK' : 'FAIL', tone: game.found ? 'ok' : 'alert' },
    game.found
      ? { text: `CYBERPUNK 2077 // PATCH ${game.patch} // BUILD ${game.build}`, status: 'LINKED', tone: 'ok' }
      : { text: game.error ?? 'GAME NOT FOUND', status: 'SET PATH', tone: 'alert' },
    { text: 'PHANTOM LIBERTY', status: game.phantomLiberty ? 'DETECTED' : 'ABSENT', tone: game.phantomLiberty ? 'ok' : 'warn' },
    { text: 'REDMOD TOOLCHAIN', status: game.redmodTool ? 'DETECTED' : 'NOT INSTALLED', tone: game.redmodTool ? 'ok' : 'warn' },
    { text: `STAGING ${app.dataRoot}`, status: app.sameVolume ? 'HARDLINK READY' : 'COPY MODE', tone: app.sameVolume ? 'ok' : 'warn' },
    { text: `FRAMEWORKS ONLINE ${inv.installedFrameworks.length}`, status: inv.installedFrameworks.length ? 'OK' : 'NONE', tone: inv.installedFrameworks.length ? 'ok' : 'warn' },
    { text: `IMPLANTS ${inv.mods.length} // ACTIVE ${active}`, status: inv.deploy.suspended ? 'VANILLA MODE' : 'SYNCED', tone: inv.deploy.suspended ? 'warn' : 'ok' },
    ...(game.updatedSinceLastRun ? [{ text: `GAME UPDATED ${game.previousBuild} → ${game.build}`, status: 'CHECK CYBERWARE', tone: 'alert' as const }] : []),
  ]

  useEffect(() => {
    play('boot')
    const timers = lines.map((_, i) => setTimeout(() => setShown(i + 1), 140 + i * 125))
    const end = setTimeout(() => setLeaving(true), 140 + lines.length * 125 + 650)
    return () => {
      timers.forEach(clearTimeout)
      clearTimeout(end)
    }
    // nur einmal beim Öffnen
  }, [])

  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(props.onDone, 380)
    return () => clearTimeout(t)
  }, [leaving, props.onDone])

  useEffect(() => {
    const skip = () => setLeaving(true)
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [])

  const progress = Math.min(1, shown / lines.length)

  return (
    <div className={`boot${leaving ? ' boot--leave' : ''}`} onClick={() => setLeaving(true)}>
      <div className="boot__frame">
        <div className="boot__head">
          <span className="brand__mark brand__mark--big">R</span>
          <div>
            <div className="boot__title">{BRAND.name}</div>
            <Micro>MOD CLINIC // IMPLANT MANAGEMENT // NIGHT CITY</Micro>
          </div>
          <span className="boot__spacer" />
          <Barcode seed={42} bars={30} />
        </div>
        <div className="boot__lines">
          {lines.slice(0, shown).map((l, i) => (
            <div key={i} className="boot__line">
              <span className="boot__idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="boot__text">{l.text}</span>
              <span className="boot__dots" />
              <span className={`boot__status ${l.tone === 'alert' ? 'alert' : l.tone === 'warn' ? 'special' : 'accent'}`}>{l.status}</span>
            </div>
          ))}
        </div>
        <div className="boot__bar">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="boot__foot">
          <Micro>CLICK OR PRESS ANY KEY TO SKIP</Micro>
          <Micro>{Math.round(progress * 100)}%</Micro>
        </div>
      </div>
    </div>
  )
}
